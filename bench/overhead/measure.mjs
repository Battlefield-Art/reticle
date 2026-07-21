// §5.11 — SDK overhead budget. "An observability layer that slows the app corrupts its own perf
// verdicts", so the release bar is: total instrumentation overhead (stacks, store subscriptions,
// journal writes, DOM/network observers) < 3% of main-thread time, measured on the HOSTILE fixture —
// the page that never goes quiet, i.e. the worst realistic case.
//
// Method: load the same hostile page twice in the same browser — once with the SDK installed, once with
// `?no-hud` (which skips Reticle entirely) — and read Chrome's own cumulative `TaskDuration` metric over
// an identical wall-clock window. Overhead is the difference expressed as a share of that window, so it
// is main-thread PERCENTAGE POINTS, not a ratio of an arbitrary baseline.
//
//   node bench/overhead/measure.mjs [url] [seconds]
//
// Requires the bench-app running (default http://localhost:4312). Alternates the order of the two
// conditions across repeats so warm-up/JIT drift cannot systematically favour either one.

import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4312';
const WINDOW_S = Number(process.argv[3] ?? 8);
const REPEATS = 3;
const BUDGET_PCT = 3;

const metric = (metrics, name) => metrics.find((m) => m.name === name)?.value ?? 0;

/** Drive one condition and return the main-thread task-seconds consumed during the window. */
async function measureOnce(browser, { withSdk }) {
  const page = await browser.newPage();
  const url = withSdk ? BASE : `${BASE}/?no-hud`;
  await page.goto(url, { waitUntil: 'load' });

  // Sign in, then click through to the hostile view — by CLICK, so it works with the SDK disabled.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sign in'),
    );
    btn?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll('button,a')].find((b) =>
      b.textContent?.trim().startsWith('Hostile'),
    );
    nav?.click();
  });
  // Confirm we are actually on the churning page — a silent miss would measure an idle page and
  // report a flatteringly small overhead.
  await page.waitForSelector('[data-testid="hostile-ticker"]', { timeout: 5000 });
  await page.waitForTimeout(1000); // let the churn reach steady state before sampling

  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const before = (await client.send('Performance.getMetrics')).metrics;
  const t0 = Date.now();
  await page.waitForTimeout(WINDOW_S * 1000);
  const after = (await client.send('Performance.getMetrics')).metrics;
  const wallS = (Date.now() - t0) / 1000;

  const taskS = metric(after, 'TaskDuration') - metric(before, 'TaskDuration');
  await page.close();
  return { taskS, wallS };
}

const browser = await chromium.launch({ headless: true });
const samples = [];
for (let i = 0; i < REPEATS; i++) {
  // Alternate order so warm-up never systematically favours one condition.
  const order = i % 2 === 0 ? [true, false] : [false, true];
  const run = {};
  for (const withSdk of order) run[withSdk ? 'on' : 'off'] = await measureOnce(browser, { withSdk });
  samples.push(run);
  console.log(
    `  repeat ${String(i + 1)}: SDK on ${run.on.taskS.toFixed(3)}s / off ${run.off.taskS.toFixed(3)}s main-thread task time`,
  );
}
await browser.close();

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const onS = avg(samples.map((r) => r.on.taskS));
const offS = avg(samples.map((r) => r.off.taskS));
const wallS = avg(samples.map((r) => r.on.wallS));
const overheadPct = ((onS - offS) / wallS) * 100;

// The method's own resolution: how much the SAME condition varies run to run. An overhead smaller than
// this is not a measurement of the SDK, it is noise — and reporting it as a number (especially a
// flattering negative one) would be exactly the self-corrupting perf claim §5.11 exists to prevent.
const spread = (xs) => (Math.max(...xs) - Math.min(...xs)) / wallS * 100;
const noiseFloorPct = Math.max(
  spread(samples.map((r) => r.on.taskS)),
  spread(samples.map((r) => r.off.taskS)),
);
const resolved = Math.abs(overheadPct) > noiseFloorPct;

console.log('\n=== SDK overhead on the hostile fixture (§5.11) ===\n');
console.log(`  window                  : ${wallS.toFixed(1)}s x ${String(REPEATS)} repeats`);
console.log(`  main-thread, SDK ON     : ${onS.toFixed(3)}s  (${((onS / wallS) * 100).toFixed(1)}% busy)`);
console.log(`  main-thread, SDK OFF    : ${offS.toFixed(3)}s  (${((offS / wallS) * 100).toFixed(1)}% busy)`);
console.log(`  measured difference     : ${overheadPct >= 0 ? '+' : ''}${overheadPct.toFixed(2)} pp of main thread`);
console.log(`  method noise floor      : ±${noiseFloorPct.toFixed(2)} pp (same-condition run-to-run spread)`);
if (resolved) {
  console.log(`  instrumentation overhead: ${overheadPct.toFixed(2)} pp — resolved above noise`);
} else {
  console.log(
    `  instrumentation overhead: NOT RESOLVABLE — below this method's noise floor.\n` +
      `                            Report as "< ${noiseFloorPct.toFixed(1)}pp", never as the raw signed number.`,
  );
}
const pass = overheadPct < BUDGET_PCT; // an unresolvable difference is, by construction, under budget
console.log(`  budget                  : < ${String(BUDGET_PCT)}%  →  ${pass ? 'PASS' : 'FAIL'}\n`);

process.exit(pass ? 0 : 1);
