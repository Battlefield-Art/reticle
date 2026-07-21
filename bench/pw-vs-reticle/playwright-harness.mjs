// Playwright-SCRIPT harness: a deterministic Playwright script (no LLM) that verifies each bug's
// intent using only what a browser automation tool can see — the DOM, computed styles, hit-testing,
// console, network, and pixels. It has NO access to the app's store or React commit stream, so the
// state/blast-radius checks structurally cannot be made (that gap is the benchmark's point). Measures
// bytes pulled to decide (screenshots are a real, large cost), latency, and detection.
import { chromium } from 'playwright';
import { bugUrl, storageBugUrl } from './bugs.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (t) => `[data-testid="${t}"]`;

export async function runPlaywright(bugs) {
  const browser = await chromium.launch();
  const results = [];
  let baseline = null; // clean full-viewport screenshot, captured before any buggy paint compare

  for (const bug of bugs) {
    for (const variant of ['clean', 'buggy']) {
      const makeUrl = bug.category === 'storage' ? storageBugUrl : bugUrl;
      const url = variant === 'buggy' ? (bug.url ?? makeUrl(bug.id)) : makeUrl('');
      const t0 = Date.now();
      let bytes = 0,
        caught = false,
        note = '';
      const consoleErrors = [];
      const requests = [];
      // fresh context+page per run so a crash/close never cascades to later bugs.
      const ctx = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
      // Response statuses: Playwright CAN see these, so the hidden-500 class is fairly 'both'.
      const responses = [];
      page.on('response', (r) =>
        responses.push({
          url: r.url(),
          status: r.status(),
          contentType: String(r.headers()['content-type'] ?? ''),
        }),
      );
      const click = async (t) => {
        try {
          await page.locator(sel(t)).click({ timeout: 4000, force: true });
        } catch {}
      };
      const waitFor = async (t, ms = 6000) => {
        try {
          await page.locator(sel(t)).first().waitFor({ state: 'attached', timeout: ms });
          return true;
        } catch {
          return false;
        }
      };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await sleep(600); // let React hydrate + set the pre-filled login inputs before clicking submit
        const fillPrep = async (prep) => {
          if (prep?.fill) {
            await page.fill(sel(prep.fill), prep.text).catch(() => {});
            await sleep(200);
          }
        };
        for (const t of bug.setup) {
          await waitFor(t);
          await click(t);
          await sleep(400);
        }
        const seen = await page
          .evaluate(() =>
            [...document.querySelectorAll('[data-testid]')]
              .map((e) => e.getAttribute('data-testid'))
              .slice(0, 12),
          )
          .catch(() => []);
        const err = await page
          .locator('[data-testid="login-error"]')
          .innerText()
          .catch(() => '');
        const diag = ` [seen:${seen.join(',')}${err ? ' loginErr:' + err : ''}]`;
        const c = bug.check;
        if (c.kind === 'usable') {
          const ok = await waitFor(c.testid, 6000);
          const loc = page.locator(sel(c.testid)).first();
          const box = ok ? await loc.boundingBox().catch(() => null) : null;
          const info = ok
            ? await loc
                .evaluate((el) => {
                  const s = getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  return {
                    opacity: s.opacity,
                    cursor: s.cursor,
                    occluded: top !== el && !el.contains(top),
                  };
                })
                .catch(() => null)
            : null;
          bytes += JSON.stringify({ box, info }).length;
          caught = !ok
            ? false
            : !box ||
              box.width === 0 ||
              box.height === 0 ||
              (info && (info.opacity === '0' || info.occluded));
          note = ok
            ? `box=${box?.width}x${box?.height} opacity=${info?.opacity} occluded=${info?.occluded}`
            : 'element not found';
        } else if (c.kind === 'paint') {
          await sleep(400);
          const shot = await page.screenshot({ fullPage: false });
          bytes += shot.length;
          if (variant === 'clean') {
            baseline = shot;
            caught = false;
            note = `baseline captured (${shot.length}B)`;
          } else {
            const ref = baseline ?? shot;
            const n = Math.min(ref.length, shot.length);
            let diff = Math.abs(ref.length - shot.length);
            for (let i = 0; i < n; i++) if (ref[i] !== shot[i]) diff++;
            const ratio = diff / Math.max(ref.length, shot.length, 1);
            caught = ratio > 0.15;
            note = `png-byte diff ratio=${ratio.toFixed(3)} (shot ${shot.length}B)`;
          }
        } else if (c.kind === 'domCountMatchesState') {
          const txt = await page
            .locator(`${sel(c.testid)} .nav-badge`)
            .innerText()
            .catch(() => '');
          bytes += txt.length;
          caught = false; // reads the badge, but has no store truth to compare -> cannot catch the lie
          note = `badge="${txt.trim()}" — no app-state access to compare against`;
        } else if (c.kind === 'consoleCleanAfter') {
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          consoleErrors.length = 0;
          if (ok) await click(c.steps[0]);
          await sleep(500);
          bytes += consoleErrors.join('').length;
          caught = ok ? consoleErrors.length > 0 : false;
          note = ok ? `errors=${consoleErrors.length}` : 'compose-generate not reached';
        } else if (c.kind === 'netCountAfter') {
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          requests.length = 0;
          if (ok) await click(c.steps[0]);
          await sleep(700);
          const n = requests.filter(
            (r) => r.method === c.method && r.url.includes(c.urlContains),
          ).length;
          bytes += JSON.stringify(requests).length;
          caught = ok ? n !== c.expected : false;
          note = ok ? `count=${n} expected=${c.expected}` : 'compose-generate not reached';
        } else if (c.kind === 'stateInvariantAfter') {
          const ok = await waitFor(c.steps[0]);
          if (ok) await click(c.steps[0]);
          await sleep(300);
          caught = false; // off-screen store mutation, no DOM signal exists for Playwright to read
          note = 'no app-state access — off-screen store mutation is invisible to the DOM';
        } else if (c.kind === 'domText') {
          const ok = await waitFor(c.testid);
          const txt = ok
            ? (
                await page
                  .locator(sel(c.testid))
                  .first()
                  .innerText()
                  .catch(() => '')
              )
                .replace(/\s+/g, ' ')
                .trim()
            : '';
          bytes += txt.length;
          caught = ok && txt ? !txt.includes(String(c.expected)) : false;
          note = ok ? `text="${txt.slice(0, 40)}" expected~="${c.expected}"` : 'element not found';
        } else if (c.kind === 'stateEqualsAfter') {
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          if (ok) await click(c.steps[0]);
          await sleep(400);
          caught = false; // the invariant lives in the store; Playwright has no access to assert it
          note = 'no app-state access — store invariant not assertable from the DOM';
        } else if (c.kind === 'domPresentVsBaseline') {
          // Playwright CAN check presence — no charity, this one is fairly 'both'.
          const el = await page.$(`[data-testid="${c.testid}"]`);
          caught = el === null;
          note = `testid ${c.testid} present=${el === null ? 0 : 1}`;
        } else if (c.kind === 'perfClsUnder' || c.kind === 'perfNoLongTaskAfter') {
          await sleep(400);
          caught = false;
          note = 'no layout-shift / long-task oracle in the deterministic script harness';
        } else if (c.kind === 'routeAfter') {
          // Playwright reads location directly, so a WRONG-PATH route is genuinely catchable here.
          // A DOUBLE history push is not — that needs the route event stream, not the final URL.
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          if (ok) await page.click(`[data-testid="${c.steps[0]}"]`);
          await sleep(400);
          if (!ok) {
            caught = false;
            note = `${c.steps[0]} not reached`;
          } else if (c.expectRoutes !== undefined) {
            caught = false;
            note = 'final URL cannot reveal a duplicate history entry';
          } else {
            const path = page.url();
            caught = !path.includes(c.expectPath);
            note = `url=${path} expected~${c.expectPath}`;
          }
        } else if (c.kind === 'signalFiredAfter') {
          // Playwright has no access to the app's signal stream at all — not a gap in this script, a
          // structural one. Recorded honestly as uncatchable rather than quietly skipped.
          await fillPrep(c.prep);
          caught = false;
          note = 'no signal stream visible to a DOM/pixel tool';
        } else if (c.kind === 'storagePresentAfter') {
          // Playwright reads storage directly via evaluate, so this class is genuinely catchable here.
          for (const t of c.steps ?? []) {
            await click(t);
            await sleep(250);
          }
          await sleep(2500); // sign-in POSTs before it persists
          const present = await page.evaluate(
            ({ area, key }) => {
              if (area === 'local') return localStorage.getItem(key) !== null;
              if (area === 'session') return sessionStorage.getItem(key) !== null;
              return document.cookie.split('; ').some((c) => c.startsWith(`${key}=`) && !c.endsWith('='));
            },
            { area: c.area, key: c.key },
          );
          caught = present !== c.expectPresent;
          note = `${c.area}[${c.key}] present=${present} expected=${c.expectPresent}`;
        } else if (c.kind === 'domAbsentAfterDelay') {
          // Playwright can wait and re-check presence, so timing-of-disappearance is a fair 'both'.
          await fillPrep(c.prep);
          for (const t of c.steps ?? []) {
            await click(t);
            await sleep(250);
          }
          await sleep(c.delayMs);
          const el = await page.$(`[data-testid="${c.testid}"]`);
          caught = el !== null;
          note = `${c.testid} present after ${c.delayMs}ms = ${el !== null}`;
        } else if (c.kind === 'settlesDespiteAnimation') {
          // No settle oracle in the deterministic script harness — it cannot over-flag what it never
          // evaluates, so the trap is vacuously passed here rather than scored as a win.
          caught = false;
          note = 'no settle oracle in the script harness — trap not exercised';
        } else if (c.kind === 'domTextDeep') {
          // Playwright pierces open shadow roots in its own locators and can address a frame
          // explicitly, so this is a fair 'both' — not a Reticle-only win.
          let text = '';
          if (c.frame === true) {
            const f = page.frames().find((fr) => fr.url().includes('panel.html'));
            text = f ? await f.evaluate(() => document.body.innerText) : '';
          } else {
            text = await page
              .locator(`[data-testid="${c.deepTestid}"]`)
              .first()
              .innerText()
              .catch(() => '');
          }
          caught = !text.includes(c.expectText);
          note = `expected "${c.expectText}": ${text.includes(c.expectText)}`;
        } else if (c.kind === 'deepNetCountAfter') {
          const before = requests.filter((r) => r.url.includes(c.urlContains)).length;
          await page
            .locator(`[data-testid="${c.deepTestid}"]`)
            .first()
            .click({ timeout: 4000 })
            .catch(() => {});
          await sleep(900);
          const after = requests.filter((r) => r.url.includes(c.urlContains)).length;
          caught = after - before < 1;
          note = `${c.urlContains} calls +${after - before}`;
        } else if (c.kind === 'deepCountMatchesState') {
          // Playwright can read the frame, but the STORE length is not reachable from the DOM — the
          // visible row count is a different number (it is filtered/capped). Recorded as a structural
          // gap rather than pretended.
          caught = false;
          note = 'no app-state access — cannot compare the frame against the store';
        } else if (c.kind === 'streamFramesAfter' || c.kind === 'streamVsDomCount') {
          // An SSE body is a streaming response; this script harness sees the request, never the
          // individual frames, so it cannot compare the wire against the DOM. Stated, not skipped.
          await sleep(c.waitMs ?? 2500);
          caught = false;
          note = 'no SSE frame visibility in the script harness';
        } else if (c.kind === 'streamPayloadAfter') {
          // Playwright DOES expose WebSocket frames via page.on('websocket'), so this one is a fair
          // 'both' — claiming it as reticle-only would be charity to ourselves.
          const frames = [];
          page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
          for (const t of c.steps ?? []) {
            await click(t);
            await sleep(250);
          }
          await sleep(c.waitMs ?? 1200);
          const hit = frames.some((f) => f.includes(c.expectContains));
          caught = !hit;
          note = `frame containing "${c.expectContains}": ${hit} (${frames.length} frames)`;
        } else if (c.kind === 'netCountAfterBurst') {
          // Playwright sees requests, so request-count timing is a fair 'both'.
          for (const value of c.values) {
            await page.locator(sel(c.testid)).fill(value).catch(() => {});
            await sleep(c.gapMs ?? 60);
          }
          await sleep(c.settleMs ?? 1200);
          const n = requests.filter((r) => r.url.includes(c.urlContains)).length;
          caught = n > c.maxExpected;
          note = `${c.urlContains} requests=${n} (max ${c.maxExpected})`;
        } else if (c.kind === 'netCountCapped') {
          for (const t of c.steps ?? []) {
            await click(t);
            await sleep(200);
          }
          await sleep(c.settleMs ?? 3000);
          const n = requests.filter((r) => r.url.includes(c.urlContains)).length;
          caught = n > c.maxExpected;
          note = `${c.urlContains} attempts=${n} (max ${c.maxExpected})`;
        } else if (c.kind === 'stableTextDespiteChurn') {
          const read = async (t) =>
            page.locator(sel(t)).first().innerText().catch(() => '');
          const first = await read(c.churnTestid);
          await sleep(c.waitMs ?? 1200);
          const second = await read(c.churnTestid);
          const stableText = await read(c.stableTestid);
          caught = first !== second && !stableText.includes(c.expectStable);
          note = `churned=${first !== second} stable="${stableText}"`;
        } else if (c.kind === 'netStatusAfter') {
          // Playwright sees response statuses, so this class is genuinely catchable here — no charity.
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          if (ok) await click(c.steps[0]);
          await sleep(800);
          const matches = responses.filter((r) => r.url.includes(c.urlContains));
          const good = matches.filter(
            (r) =>
              r.status === Number(c.expected) &&
              (c.contentType === undefined || r.contentType.includes(c.contentType)),
          );
          caught = ok ? good.length === 0 : false;
          note = ok
            ? `matched=${matches.length} ok=${good.length}`
            : `${c.steps[0]} not reached`;
        } else if (c.kind === 'netBodyAfter') {
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          if (ok) await click(c.steps[0]);
          await sleep(400);
          caught = false;
          note = 'request/response bodies not captured by the deterministic script harness';
        } else if (c.kind === 'netPendingAfter') {
          await fillPrep(c.prep);
          const ok = await waitFor(c.steps[0]);
          if (ok) await click(c.steps[0]);
          await sleep(400);
          caught = false;
          note = 'no in-flight-request oracle — a never-resolving request looks like nothing happened';
        }
        if (!caught && (note.includes('not found') || note.includes('not reached'))) note += diag;
      } catch (e) {
        note = `ERR ${e.message}`;
      }
      await ctx.close().catch(() => {});
      results.push({
        harness: 'playwright-script',
        bug: bug.id,
        category: bug.category,
        variant,
        caught,
        expect: bug.expect,
        bytes,
        ms: Date.now() - t0,
        note,
      });
    }
  }

  await browser.close();
  return results;
}
