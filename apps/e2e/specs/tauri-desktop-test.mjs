// HONESTY-CRITICAL: prove Reticle's Tauri support against a REAL Tauri v2 binary, headless.
//
// Runs the PACKAGED build (`tauri://localhost`, frontendDist), not `tauri dev` — the dev path serves
// the frontend from an ordinary http origin, so it exercises none of what is Tauri-specific: the
// opaque origin the bridge's upgrade handler once crashed on, and the locality gate that used to
// read a desktop webview as a remote website and refuse to start.
//
// Pinned here:
//   - the webview dials the bridge from tauri://localhost
//   - an `invoke` is observed as ipc://<command> with no JavaScript-side wiring at all
//   - a command returning Err is recorded as FAILED despite the transport's HTTP 200
//   - the planted false green is reported as a contradiction
//   - `reticle_capture` photographs the webview while the window is hidden (headless)
//   - fullPage is refused on macOS/Windows rather than downgraded
//   - concurrent captures all survive, and nothing is left in the temp dir
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, bootDesktopSession, checker, sleep, tempCaptures } from '../desktop-harness.mjs';

const { chk, state } = checker();

/**
 * The packaged binary, built by `pnpm e2e:desktop` (or the CI job) before this spec runs.
 *
 * Missing means the build step did not happen — a setup fault, reported as a failure rather than a
 * skip. A desktop battery that quietly tests nothing is the failure this spec exists to prevent.
 */
const BINARY = path.join(ROOT, 'apps/tauri-smoke/src-tauri/target/release/tauri-smoke');
if (!existsSync(BINARY)) {
  console.error(
    `\n❌ no packaged Tauri binary at ${BINARY}\n` +
      '   build it first:  pnpm --filter @reticlehq/tauri-smoke exec tauri build --no-bundle\n',
  );
  process.exit(1);
}

console.log('\n=== DESKTOP: Tauri v2 (packaged binary, headless) ===');

let session;
try {
  session = await bootDesktopSession({
    spawnApp: (env) =>
      spawn(BINARY, [], {
        cwd: path.join(ROOT, 'apps/tauri-smoke/src-tauri'),
        env: { ...env, RETICLE_HEADLESS: '1' },
      }),
  });
  const { tool, refOf, sessionId, server, log } = session;

  chk('the Tauri webview dialed the bridge', sessionId !== undefined);
  if (sessionId === undefined) {
    console.log(log.join('').slice(-3000));
    throw new Error('no session');
  }
  chk(
    'it connected from the packaged opaque origin, not a dev server',
    server.bridge.sessions.list()[0]?.url === 'tauri://localhost',
    String(server.bridge.sessions.list()[0]?.url),
  );

  for (let i = 0; i < 40; i++) {
    if (JSON.stringify(await tool('reticle_network', {})).includes('ipc://load_todos')) break;
    await sleep(200);
  }
  const boot = await tool('reticle_network', {});
  chk(
    'an invoke is observed as ipc://load_todos with no frontend wiring',
    JSON.stringify(boot).includes('ipc://load_todos'),
    JSON.stringify(boot.calls?.[0] ?? {}),
  );

  // ── the planted false green ────────────────────────────────────────────────────────────────────
  const archived = await tool('reticle_act', { ref: await refOf('archive-1'), action: 'click' });
  chk('the archive click landed', archived.result?.ok === true);
  // Wait for the command to SETTLE, not merely to appear: an in-flight call is already listed (as
  // `status: "pending"`), so polling on presence reads the request before its verdict exists.
  let failed;
  for (let i = 0; i < 40; i++) {
    failed = await tool('reticle_network', { urlContains: 'ipc://archive_todo' });
    if (typeof failed.calls?.[0]?.status === 'number') break;
    await sleep(200);
  }
  // Tauri's transport answers HTTP 200 whether the command returned Ok or Err. Without translating
  // the `Tauri-Response` header, every failed Rust command is banked as a successful request.
  chk(
    'a command that returned Err is recorded as FAILED despite the transport 200',
    failed.calls?.[0]?.status === 500 && failed.calls[0].statusText === 'Err',
    JSON.stringify(failed.calls?.[0] ?? {}),
  );

  const byOk = await tool('reticle_network', { ok: false });
  chk(
    'reticle_network { ok: false } returns ONLY failed commands',
    byOk.calls?.length > 0 && byOk.calls.every((c) => c.status === 500),
    JSON.stringify(byOk.calls),
  );

  const verdict = await tool('reticle_assert', {
    predicate: { kind: 'net', urlContains: 'ipc://archive_todo', ok: false },
  });
  chk('assert { net, ok:false } passes with the command record as evidence', verdict.pass === true);

  const observed = await tool('reticle_observe', {});
  chk(
    'a contradiction names the failed command',
    (observed.contradictions ?? []).some((c) => c.detail.includes('archive_todo')),
    JSON.stringify(observed.contradictions ?? []),
  );

  // ── capture, from a window that is not on screen at all ───────────────────────────────────────
  const shot = await tool('reticle_screenshot', { name: 'tauri-home' });
  chk(
    'reticle_capture photographs the webview while the window is hidden',
    shot.saved === true,
    `${String(shot.bytes)} bytes`,
  );
  chk('the capture is a real PNG, not a truncated one', (shot.bytes ?? 0) > 10_000);

  const full = await tool('reticle_screenshot', { name: 'tauri-full', fullPage: true });
  // WebKitGTK can render a full document offscreen; WKWebView and WebView2 cannot and must refuse.
  const linux = process.platform === 'linux';
  chk(
    linux
      ? 'fullPage is honoured on WebKitGTK'
      : 'fullPage is REFUSED here, never downgraded to a viewport image',
    linux ? full.saved === true : full.reason === 'full-page-unsupported',
    JSON.stringify(full),
  );

  const concurrent = await Promise.all(
    [1, 2, 3].map((i) => tool('reticle_screenshot', { name: `tauri-concurrent-${String(i)}` })),
  );
  chk(
    'three concurrent captures all succeed',
    concurrent.every((s) => s.saved === true),
    JSON.stringify(concurrent.map((s) => s.reason ?? s.saved)),
  );
  chk('no capture is left behind in the temp dir', tempCaptures().length === 0, tempCaptures().join(','));

  /**
   * The webview must still be there a few seconds later.
   *
   * Everything above runs within a couple of seconds of connect, so this spec only ever proved that
   * Tauri works IMMEDIATELY after connect — and an agent doing real work is past that in one tool
   * call. Nothing here had ever checked that the session survives an ordinary pause.
   *
   * It does: this passes. The check exists because the absence of it is unfalsifiable, not because a
   * failure was found. (A probe that appeared to show the session dying at ~9s did not reproduce once
   * the machine was quiet, and is not evidence of anything.)
   */
  await sleep(12_000);
  let aliveLater = false;
  try {
    await tool('reticle_snapshot', {});
    aliveLater = true;
  } catch (error) {
    aliveLater = false;
    console.log(`   (durability probe: ${String(error).slice(0, 140)})`);
  }
  chk('the session still answers 12s after connect, not just immediately', aliveLater);
} finally {
  await session?.shutdown();
}

console.log(
  `\n${state.fail === 0 ? '✅ TAURI DESKTOP VERIFIED' : '❌ FAILED'} (${String(state.pass)} passed, ${String(state.fail)} failed)`,
);
process.exit(state.fail === 0 ? 0 : 1);
