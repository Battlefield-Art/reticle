/**
 * Verb-level contracts for the ten cloud commands (#555). The existing `cloud-cli.test.ts` covers the
 * `api()` JSON guard; nothing exercised a VERB. One test per verb pins the wire shape (method, URL,
 * auth header, body) against a stubbed `fetch`, or the local-state contract for the verbs that never
 * dial. `$HOME` and cwd are pointed at temp dirs (`mkdtemp` + env stubs, per repo convention) so a
 * developer's real `~/.reticle` session can never leak into a run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCloudCommand } from './cloud-cli.js';

interface RecordedRequest {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

interface StubResponse {
  /** HTTP status; default 200. */
  status?: number;
  /** Parsed-to-JSON response body. */
  body?: unknown;
}

const RETICLE_DIR = '.reticle';
const SESSION_FILE = 'session.json';
const CREDENTIALS_FILE = 'credentials.json';
const CLOUD_LINK_FILE = 'cloud.json';
const TEST_URL = 'http://localhost:9999';
const TEST_KEY = 'rk_live_test';

describe('cloud-cli verb contracts (#555)', () => {
  let home: string;
  let cwd: string;
  let origCwd: string;
  let origHomeEnv: string | undefined;
  let origUserProfileEnv: string | undefined;
  let origUrlEnv: string | undefined;
  let origKeyEnv: string | undefined;
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  const origFetch = globalThis.fetch;
  let stdoutBuf = '';
  let stderrBuf = '';
  let requests: RecordedRequest[] = [];
  let responder: (url: string) => StubResponse;

  const lastJsonOutput = (): unknown => {
    const chunks = stdoutBuf.trim().split('\n\n');
    return JSON.parse(chunks[chunks.length - 1] ?? '{}');
  };

  const writeRepoFile = async (rel: string[], content: string): Promise<void> => {
    const dir = join(cwd, RETICLE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ...rel), content);
  };

  const writeHomeFile = async (rel: string[], content: string): Promise<void> => {
    const dir = join(home, RETICLE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ...rel), content);
  };

  beforeEach(async () => {
    stdoutBuf = '';
    stderrBuf = '';
    requests = [];
    responder = () => ({});
    process.stdout.write = (chunk: unknown) => {
      stdoutBuf += String(chunk);
      return true;
    };
    process.stderr.write = (chunk: unknown) => {
      stderrBuf += String(chunk);
      return true;
    };
    origHomeEnv = process.env['HOME'];
    origUserProfileEnv = process.env['USERPROFILE'];
    origUrlEnv = process.env['RETICLE_CLOUD_URL'];
    origKeyEnv = process.env['RETICLE_CLOUD_KEY'];
    delete process.env['RETICLE_CLOUD_URL'];
    delete process.env['RETICLE_CLOUD_KEY'];
    home = await mkdtemp(join(tmpdir(), 'reticle-cloudhome-'));
    cwd = await mkdtemp(join(tmpdir(), 'reticle-cloudcwd-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    origCwd = process.cwd();
    process.chdir(cwd);
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<unknown> => {
      const url = 'string' === typeof input ? input : input instanceof URL ? input.href : input.url;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const rawBody = init?.body;
      let body: unknown;
      if ('string' === typeof rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
      requests.push({
        url,
        method: init?.method ?? 'GET',
        authorization: headers['authorization'] ?? null,
        body,
      });
      const res = responder(url);
      const status = res.status ?? 200;
      return Promise.resolve({
        ok: status >= 200 && status <= 299,
        status,
        statusText: '',
        text: () => Promise.resolve(JSON.stringify(res.body ?? {})),
      });
    }) as unknown as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
    process.chdir(origCwd);
    if (origHomeEnv === undefined) delete process.env['HOME'];
    else process.env['HOME'] = origHomeEnv;
    if (origUserProfileEnv === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = origUserProfileEnv;
    if (origUrlEnv === undefined) delete process.env['RETICLE_CLOUD_URL'];
    else process.env['RETICLE_CLOUD_URL'] = origUrlEnv;
    if (origKeyEnv === undefined) delete process.env['RETICLE_CLOUD_KEY'];
    else process.env['RETICLE_CLOUD_KEY'] = origKeyEnv;
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('login --email exchanges a dev-mailed code and persists the session (POST shapes)', async () => {
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    responder = (url) =>
      url.endsWith('/v1/auth/request-code')
        ? { body: { devCode: '654321' } }
        : { body: { token: 'tok_1', org: { name: 'Acme' } } };

    const code = await runCloudCommand(['login', '--email', 'dev@example.com', '--org', 'Acme']);

    expect(code).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(`${TEST_URL}/v1/auth/request-code`);
    expect(requests[0]?.body).toEqual({ email: 'dev@example.com', orgName: 'Acme' });
    expect(requests[0]?.authorization).toBeNull();
    expect(requests[1]?.method).toBe('POST');
    expect(requests[1]?.url).toBe(`${TEST_URL}/v1/auth/login`);
    expect(requests[1]?.body).toEqual({ email: 'dev@example.com', code: '654321' });
    const session = JSON.parse(
      await readFile(join(home, RETICLE_DIR, SESSION_FILE), 'utf8'),
    ) as Record<string, unknown>;
    expect(session['token']).toBe('tok_1');
    expect(session['orgName']).toBe('Acme');
    expect(session['url']).toBe(TEST_URL);
  });

  it('login without RETICLE_CLOUD_URL dials the hosted service, not the developer machine', async () => {
    responder = () => ({ status: 500, body: { error: { message: 'down' } } });

    const code = await runCloudCommand(['login']);

    expect(code).toBe(1);
    expect(requests).toHaveLength(1);
    // The whole point: somebody who installed the package and typed `reticle login` reaches the
    // product. A localhost default sent every real user at a port on their own machine that
    // nothing is serving, and that failure reads as "the cloud is down" rather than "wrong host".
    expect(requests[0]?.url).toBe('https://app.reticle.sh/v1/auth/device/start');
    // ...and it does NOT nag about RETICLE_CLOUD_URL. Dialling the hosted service is now the
    // CORRECT default, and warning about correct behaviour trains people to ignore the one
    // channel that carries real problems. The variable stays in `reticle --help`.
    expect(stderrBuf).not.toContain('RETICLE_CLOUD_URL');
    // The device flow never reached its browser-open step, so nothing spawned.
    expect(stderrBuf).not.toContain('Opening');
  });

  it('RETICLE_CLOUD_URL overrides the default — which is how this repo develops against localhost', async () => {
    process.env['RETICLE_CLOUD_URL'] = 'http://localhost:8890';
    responder = () => ({ status: 500, body: { error: { message: 'down' } } });

    const code = await runCloudCommand(['login']);

    expect(code).toBe(1);
    expect(requests[0]?.url).toBe('http://localhost:8890/v1/auth/device/start');
  });

  it('logout clears the cached session file without touching the network', async () => {
    await writeHomeFile([SESSION_FILE], '{"token":"tok","orgName":"Acme","url":"http://c"}');

    const code = await runCloudCommand(['logout']);

    expect(code).toBe(0);
    expect(await readFile(join(home, RETICLE_DIR, SESSION_FILE), 'utf8')).toBe('');
    expect(lastJsonOutput()).toEqual({ loggedOut: true });
    expect(requests).toHaveLength(0);
  });

  it("whoami reports the session and this repo's attach state without dialling", async () => {
    await writeHomeFile(
      [SESSION_FILE],
      JSON.stringify({ token: 'tok', orgName: 'Acme', url: 'http://cloud.test' }),
    );
    await writeHomeFile([CREDENTIALS_FILE], JSON.stringify({ proj_1: 'rk_live_whoami' }));
    await writeRepoFile(
      [CLOUD_LINK_FILE],
      JSON.stringify({
        projectId: 'proj_1',
        projectName: 'Proj',
        url: 'http://cloud.test',
        sync: { runs: false },
        verify: 'server',
      }),
    );

    const code = await runCloudCommand(['whoami']);

    expect(code).toBe(0);
    expect(lastJsonOutput()).toEqual({
      loggedInAs: 'Acme',
      // The sync half of "what is my state". `neverSynced` is the distinction that matters out
      // here: a machine that has never talked to the dashboard and one whose last attempt failed
      // are both "behind", and only one of them is a problem.
      sync: {
        lastPushAt: null,
        lastPullAt: null,
        decisionsHeld: 0,
        neverSynced: true,
      },
      repo: {
        attached: true,
        projectId: 'proj_1',
        url: 'http://cloud.test',
        sync: { runs: false, memory: true, flows: true },
        verify: 'server',
      },
    });
    expect(requests, 'whoami reads local files only').toHaveLength(0);
  });

  it('link with an explicit key resolves whoami and writes the binding + credential', async () => {
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    process.env['RETICLE_CLOUD_KEY'] = TEST_KEY;
    responder = () => ({ body: { projectId: 'proj_1', projectName: 'Proj' } });

    const code = await runCloudCommand(['link']);

    expect(code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(`${TEST_URL}/v1/cloud/whoami`);
    expect(requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
    const cloudJson = JSON.parse(
      await readFile(join(cwd, RETICLE_DIR, CLOUD_LINK_FILE), 'utf8'),
    ) as Record<string, unknown>;
    expect(cloudJson['projectId']).toBe('proj_1');
    expect(cloudJson['projectName']).toBe('Proj');
    expect(cloudJson['url']).toBe(TEST_URL);
    expect(cloudJson['verify']).toBe('local');
    const creds = JSON.parse(
      await readFile(join(home, RETICLE_DIR, CREDENTIALS_FILE), 'utf8'),
    ) as Record<string, unknown>;
    expect(creds['proj_1']).toBe(TEST_KEY);
  });

  it('config rewrites sync flags and verify mode in place without dialling', async () => {
    await writeRepoFile(
      [CLOUD_LINK_FILE],
      JSON.stringify({ projectId: 'proj_1', projectName: 'Proj', url: 'http://cloud.test' }),
    );

    const code = await runCloudCommand(['config', '--memory', 'off', '--verify', 'server']);

    expect(code).toBe(0);
    const cfg = JSON.parse(
      await readFile(join(cwd, RETICLE_DIR, CLOUD_LINK_FILE), 'utf8'),
    ) as Record<string, unknown>;
    expect(cfg['sync']).toEqual({ runs: true, memory: false, flows: true });
    expect(cfg['verify']).toBe('server');
    expect(requests).toHaveLength(0);
  });

  it('push runs a full sync cycle: asks first, sends nothing, still collects decisions', async () => {
    /*
     * `push` used to re-upload every local run artifact on every invocation and never look at what
     * came the other way. It is now one cycle of the replication protocol, which changes the
     * contract in two visible ways and both are the point:
     *
     *   • it ASKS before sending, so an unchanged repo sends no bundle at all;
     *   • it PULLS even with nothing to push, because a quiet machine is exactly the one whose
     *     dashboard somebody has been triaging on.
     */
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    process.env['RETICLE_CLOUD_KEY'] = TEST_KEY;
    responder = () => ({ body: { knownRunIds: [], stateHashes: {}, triage: [], cursor: '0:' } });

    const code = await runCloudCommand(['push']);

    expect(code).toBe(0);
    const out = lastJsonOutput() as Record<string, unknown>;
    expect(out['ok']).toBe(true);
    expect(out['sent']).toEqual({ runs: 0, flows: 0, records: [] });
    expect(out['pulled']).toBe(0);

    const paths = requests.map((r) => r.url.replace(TEST_URL, ''));
    expect(paths, 'asked and collected; sent no bundle').toEqual([
      '/v1/sync/status',
      '/v1/sync/pull',
    ]);
    expect(requests.every((r) => r.authorization === `Bearer ${TEST_KEY}`)).toBe(true);
  });

  it('runs lists the linked project runs with the key as bearer', async () => {
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    process.env['RETICLE_CLOUD_KEY'] = TEST_KEY;
    responder = () => ({ body: { runs: [{ runId: 'run_1' }] } });

    const code = await runCloudCommand(['runs']);

    expect(code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(`${TEST_URL}/v1/runs`);
    expect(requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(lastJsonOutput()).toEqual({ runs: [{ runId: 'run_1' }] });
  });

  it('regression fetches the CI report and exits clean on zero broken flows', async () => {
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    process.env['RETICLE_CLOUD_KEY'] = TEST_KEY;
    responder = () => ({ body: { broken: [] } });

    const code = await runCloudCommand(['regression']);

    expect(code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(`${TEST_URL}/v1/project/regression`);
    expect(requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(lastJsonOutput()).toEqual({ broken: [] });
  });

  it('share mints a public link for one run and refuses a missing run id', async () => {
    process.env['RETICLE_CLOUD_URL'] = TEST_URL;
    process.env['RETICLE_CLOUD_KEY'] = TEST_KEY;
    responder = () => ({ body: { shareUrl: 'https://cloud.test/s/abc' } });

    expect(await runCloudCommand(['share'])).toBe(2);
    expect(requests).toHaveLength(0);

    const code = await runCloudCommand(['share', 'run_abc']);
    expect(code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(`${TEST_URL}/v1/runs/run_abc/share`);
    expect(requests[0]?.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(lastJsonOutput()).toEqual({ shareUrl: 'https://cloud.test/s/abc' });
  });
});
