// Reticle-SCRIPT harness: a deterministic Node script that drives the Reticle MCP tools (no LLM)
// to verify each bug's intent. Measures observation cost (bytes of tool output consumed), latency,
// and whether the check correctly caught the bug. Mirrors what an agent would do, minus the model.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpStdioClient, RETICLE_CLI as CLI } from '../harness/mcp-client.mjs';
import { APP_ORIGIN, bugUrl } from './bugs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.BENCH_RETICLE_PORT ?? '4460';

const parseText = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runReticle(bugs) {
  const client = new McpStdioClient('node', [CLI, 'mcp', '--port', PORT], {
    RETICLE_PORT: PORT,
    RETICLE_TOOL_PROFILE: 'full',
  });
  await client.start();

  // one headless Chrome; we reticle_navigate it to each bug URL (fresh SDK session per load).
  const profile = path.join(os.tmpdir(), `rbench-${process.pid}`);
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, APP_ORIGIN],
    { stdio: 'ignore', detached: true },
  );
  chrome.unref();

  let bytes = 0;
  const call = async (name, args) => {
    const { text } = await client.callTool(name, args);
    bytes += (text ?? '').length;
    return parseText(text ?? '');
  };

  // wait for the first session
  let sid;
  for (let i = 0; i < 40 && !sid; i++) {
    const s = await call('reticle_sessions', {});
    sid = s?.sessions?.[0]?.sessionId;
    if (!sid) await sleep(500);
  }

  // navigate to a URL and return the fresh focused session id
  const goto = async (url) => {
    await call('reticle_navigate', { sessionId: sid, url });
    for (let i = 0; i < 30; i++) {
      const s = await call('reticle_sessions', {});
      const all = s?.sessions ?? [];
      // Match on URL and NEVER fall back to sessions[0].
      //
      // The old pick was `find(url matches && !throttled) ?? sessions[0]`. Every headless tab reports
      // hidden/unfocused, so it is always throttled — the first branch could never win, and every run
      // silently used sessions[0], which is whichever session the daemon happens to list first,
      // routinely a stale tab from an earlier bug. That is why checks read plausible-but-wrong values
      // (an inspect returning another element's geometry) instead of failing loudly: the queries all
      // succeeded, just against the wrong page. Prefer the freshest URL match; wait rather than guess.
      const matches = all.filter((x) => x.url === url && !x.stale);
      const focused = matches.find((x) => !x.throttled) ?? matches[0];
      if (focused) {
        sid = focused.sessionId;
        if (i > 1) break;
      }
      await sleep(300);
    }
    await sleep(400); // let the app render + SDK register capabilities
  };

  const refOf = async (testid) => {
    const q = await call('reticle_query', { sessionId: sid, by: 'testid', value: testid });
    return q?.elements?.[0]?.ref;
  };
  // Post-login/nav renders are async; poll until the testid resolves (or timeout) before acting.
  const waitRef = async (testid, timeoutMs = 6000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ref = await refOf(testid);
      if (ref) return ref;
      if (Date.now() >= deadline) return undefined;
      await sleep(150);
    }
  };
  const doPrep = async (prep) => {
    if (!prep?.fill) return;
    const ref = await waitRef(prep.fill);
    if (ref) {
      await call('reticle_act', {
        sessionId: sid,
        ref,
        action: 'fill',
        args: { value: prep.text },
      });
      await sleep(200);
    }
  };
  // Benchmark controls carry real labels ("New deploy", "Deploy"); the browser's destructive-action
  // guard blocks those synthetic clicks unless the caller confirms. The harness is a deterministic
  // script driving a fixture, so it always confirms — otherwise the modal never opens.
  const CLICK_ARGS = { confirmDangerous: true };
  const clickSteps = async (steps) => {
    for (const t of steps) {
      const ref = await waitRef(t);
      if (ref)
        await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
      await sleep(250);
    }
  };

  const results = [];
  for (const bug of bugs) {
    for (const variant of ['clean', 'buggy']) {
      const url = variant === 'buggy' ? (bug.url ?? bugUrl(bug.id)) : bugUrl('');
      const before = bytes;
      const t0 = Date.now();
      let caught = false,
        note = '';
      try {
        await goto(url);
        await clickSteps(bug.setup);
        const c = bug.check;
        if (c.kind === 'usable') {
          const ref = await waitRef(c.testid);
          const ins = ref ? await call('reticle_inspect', { sessionId: sid, ref }) : null;
          const b = ins?.box;
          const st = ins?.styles ?? {};
          caught = !ref
            ? false
            : ins.occluded === true ||
              (b && (b.width === 0 || b.height === 0)) ||
              st.opacity === '0' ||
              ins.visible === false;
          note = ins
            ? `occluded=${ins.occluded} box=${b?.width}x${b?.height} opacity=${st.opacity}`
            : 'element not found';
        } else if (c.kind === 'paint') {
          caught = false;
          note = 'reticle script has no pixel diff (inspect computed-styles unchanged)';
        } else if (c.kind === 'domCountMatchesState') {
          // truth: the real store array length (depth-0 markers cap the display, so read the array).
          const st = await call('reticle_state', {
            sessionId: sid,
            store: 'app',
            path: c.statePath,
            depth: 8,
          });
          const v = st?.value;
          const truth = Array.isArray(v)
            ? v.length
            : Number((JSON.stringify(v).match(/\d+/) ?? [])[0]);
          // display: read ONLY the snapshot tree text (not JSON metadata) for the badge number.
          const snap = await call('reticle_snapshot', {
            sessionId: sid,
            scope: `[data-testid="${c.testid}"]`,
          });
          const domNum = Number((String(snap?.tree ?? '').match(/\d+/g) ?? [])[0]);
          caught = Number.isFinite(truth) && Number.isFinite(domNum) && truth !== domNum;
          note = `storeLen=${truth} badge=${domNum}`;
        } else if (c.kind === 'consoleCleanAfter') {
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          const act0 = ref
            ? await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS })
            : {};
          await sleep(400);
          const con = await call('reticle_console', {
            sessionId: sid,
            level: 'error',
            since: act0?.since,
          });
          const errs = (con?.logs ?? []).length;
          caught = ref ? errs > 0 : false;
          note = ref ? `errors=${errs}` : 'compose-generate not reached';
        } else if (c.kind === 'netCountAfter') {
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          const act0 = ref
            ? await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS })
            : {};
          await sleep(600);
          const net = await call('reticle_network', {
            sessionId: sid,
            method: c.method,
            limit: 50,
          });
          const n = (net?.calls ?? []).filter((e) =>
            String(e.url ?? '').includes(c.urlContains),
          ).length;
          caught = ref ? n !== c.expected : false;
          note = ref ? `count=${n} expected=${c.expected}` : 'compose-generate not reached';
        } else if (c.kind === 'netStatusAfter') {
          // §4.1 hidden-500: the request FAILED (or answered the wrong media type) while the UI showed
          // success. Caught when no matching call carries the expected status (+ contentType if asked).
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          if (ref) await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(800);
          const net = await call('reticle_network', { sessionId: sid, limit: 50 });
          const matches = (net?.calls ?? []).filter((e) => String(e.url ?? '').includes(c.urlContains));
          const good = matches.filter((e) => {
            if (Number(e.status) !== Number(c.expected)) return false;
            if (c.contentType === undefined) return true;
            return String(e.contentType ?? '').includes(c.contentType);
          });
          caught = ref ? good.length === 0 : false;
          note = ref
            ? `matched=${matches.length} ok=${good.length} statuses=${matches.map((m) => m.status).join('/') || 'none'}`
            : `${c.steps[0]} not reached`;
        } else if (c.kind === 'netBodyAfter') {
          // §4.1 payload truth: the body actually sent/received must contain `expected`. `direction`
          // selects request vs response; bodies are opt-in capture, so an absent body is NOT a catch —
          // reporting "missing body" as a detection would be a false positive.
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          if (ref) await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(800);
          const net = await call('reticle_network', { sessionId: sid, limit: 50 });
          const matches = (net?.calls ?? []).filter((e) => String(e.url ?? '').includes(c.urlContains));
          const field = c.direction === 'request' ? 'requestBody' : 'responseBody';
          const bodies = matches.map((m) => String(m[field] ?? ''));
          const anyBody = bodies.some((b) => b.length > 0);
          caught = ref && anyBody ? !bodies.some((b) => b.includes(c.expected)) : false;
          note = ref
            ? anyBody
              ? `${field} present, contains '${c.expected}'=${bodies.some((b) => b.includes(c.expected))}`
              : `${field} not captured (bodies are opt-in) — not counted as a detection`
            : `${c.steps[0]} not reached`;
        } else if (c.kind === 'netPendingAfter') {
          // §4.2 in-flight oracle: caught when a matching request is STILL pending after withinMs. This
          // is the one a screenshot cannot reach — on `hung-but-ui-done` the DOM already says "done".
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          if (ref) await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(c.withinMs ?? 3000);
          const net = await call('reticle_network', { sessionId: sid, limit: 50 });
          const matches = (net?.calls ?? []).filter((e) => String(e.url ?? '').includes(c.urlContains));
          const stillPending = matches.filter((e) => e.pending === true || e.status === 'pending');
          const completed = matches.filter((e) => Number(e.status) >= 200 && Number(e.status) < 400);
          // Either still hanging, or it never landed a completed 2xx at all (aborted mid-flight).
          caught = ref ? stillPending.length > 0 || completed.length === 0 : false;
          note = ref
            ? `pending=${stillPending.length} completed2xx=${completed.length} of ${matches.length}`
            : `${c.steps[0]} not reached`;
        } else if (c.kind === 'domPresentVsBaseline') {
          // §4.9 silent removal: a NON-INTERACTIVE element vanished. No click breaks, nothing errors —
          // only presence-vs-expected catches it.
          const q = await call('reticle_query', { sessionId: sid, by: 'testid', value: c.testid });
          const found = (q?.elements ?? []).length;
          caught = found === 0;
          note = `testid ${c.testid} present=${found}`;
        } else if (c.kind === 'perfClsUnder') {
          // §4.6 layout shift: a screenshot taken after things settle looks perfect; the damage is in
          // WHEN the page moved. Read the CLS the SDK already reports.
          await sleep(1200); // let the late shift actually happen before judging
          const obs = await call('reticle_observe', { sessionId: sid, limit: 200 });
          const cls = Number(obs?.summary?.layoutShift ?? 0);
          caught = cls >= Number(c.expected);
          note = `cls=${cls.toFixed(3)} threshold=${c.expected}`;
        } else if (c.kind === 'perfNoLongTaskAfter') {
          // §4.6 long task: the main thread was blocked. Invisible to any DOM assertion.
          const ref = await waitRef(c.steps[0]);
          if (ref) await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(800);
          const obs = await call('reticle_observe', { sessionId: sid, limit: 200 });
          const longTasks = Number(obs?.summary?.longTasks ?? 0);
          caught = ref ? longTasks > 0 : false;
          note = ref ? `longTasks=${longTasks} (>${c.ms}ms)` : `${c.steps[0]} not reached`;
        } else if (c.kind === 'routeAfter') {
          // §4.3 routing: the VIEW renders correctly, so every DOM assertion passes — the URL is the
          // only thing that is wrong. Deep links and the back button are broken and nothing says so.
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          const act0 = ref
            ? await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS })
            : {};
          await sleep(400);
          const obs = await call('reticle_observe', {
            sessionId: sid,
            types: ['route'],
            since: act0?.since,
            limit: 50,
          });
          const routes = (obs?.events ?? []).filter(
            (e) => String(e.type ?? '') === 'route.change',
          );
          if (!ref) {
            caught = false;
            note = `${c.steps[0]} not reached`;
          } else if (c.expectRoutes !== undefined) {
            // one click must produce exactly one history entry, or Back needs two presses
            caught = routes.length !== c.expectRoutes;
            note = `routeChanges=${routes.length} expected=${c.expectRoutes}`;
          } else {
            const last = routes.at(-1);
            const path = String(last?.data?.pathname ?? last?.data?.to ?? '');
            caught = !path.includes(c.expectPath);
            note = `path=${path || '(no route event)'} expected~${c.expectPath}`;
          }
        } else if (c.kind === 'signalFiredAfter') {
          // §4.4 signal: the network call succeeded, the DOM updated and the store is right — only the
          // app's own declared signal is missing, doubled, or typo'd. There is nothing in the rendered
          // page to compare against, which is why this category is reticle-only.
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          const act0 = ref
            ? await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS })
            : {};
          // Generous, and deliberately NOT an early-exit poll: `signal-double-fire` is only visible if
          // the whole window is observed, so stopping at the first matching signal would score a
          // double fire as correct. Measured: the signal lands well after a 600ms wait.
          await sleep(2500);
          const obs = await call('reticle_observe', {
            sessionId: sid,
            types: ['signal'],
            since: act0?.since,
            limit: 50,
          });
          // The 'signal' type bucket also carries page.health heartbeats, so match the event type
          // exactly rather than trusting the filter to mean only app signals.
          const fired = (obs?.events ?? []).filter(
            (e) => String(e?.type ?? '') === 'signal' && String(e?.data?.name ?? '') === c.signal,
          ).length;
          caught = ref ? fired !== c.expected : false;
          note = ref ? `${c.signal} fired=${fired} expected=${c.expected}` : `${c.steps[0]} not reached`;
        } else if (c.kind === 'stateInvariantAfter') {
          const pre = await call('reticle_state', {
            sessionId: sid,
            store: 'app',
            path: c.statePath,
            depth: 8,
          });
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          if (ref)
            await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(400);
          const post = await call('reticle_state', {
            sessionId: sid,
            store: 'app',
            path: c.statePath,
            depth: 8,
          });
          caught = ref ? JSON.stringify(pre?.value) !== JSON.stringify(post?.value) : false;
          note = `before=${JSON.stringify(pre?.value)} after=${JSON.stringify(post?.value)}`;
        } else if (c.kind === 'domText') {
          // reticle_query returns the element's rendered text in a `.text` field — works for
          // decorative (role=generic) nodes the a11y snapshot tree omits. For a control whose visible
          // text IS its accessible name (a button label), `.text` is omitted as redundant, so fall
          // back to `.name` — the same string the label carries.
          const q = await call('reticle_query', { sessionId: sid, by: 'testid', value: c.testid });
          const el0 = q?.elements?.[0];
          const txt = String(el0?.text ?? el0?.name ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          caught = !txt ? false : !txt.includes(String(c.expected));
          note = `text="${txt.slice(0, 40)}" expected~="${c.expected}"`;
        } else if (c.kind === 'stateEqualsAfter') {
          await doPrep(c.prep);
          const ref = await waitRef(c.steps[0]);
          if (ref)
            await call('reticle_act', { sessionId: sid, ref, action: 'click', args: CLICK_ARGS });
          await sleep(400);
          const post = await call('reticle_state', {
            sessionId: sid,
            store: 'app',
            path: c.statePath,
            depth: 8,
          });
          caught = ref ? JSON.stringify(post?.value) !== JSON.stringify(c.expected) : false;
          note = `after=${JSON.stringify(post?.value)} expected=${JSON.stringify(c.expected)}`;
        }
      } catch (e) {
        note = `ERR ${e.message}`;
      }
      results.push({
        harness: 'reticle-script',
        bug: bug.id,
        category: bug.category,
        variant,
        caught,
        expect: bug.expect,
        bytes: bytes - before,
        ms: Date.now() - t0,
        note,
      });
    }
  }

  try {
    await client.stop();
  } catch {}
  try {
    process.kill(-chrome.pid);
  } catch {}
  return results;
}
