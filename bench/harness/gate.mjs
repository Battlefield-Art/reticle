// Benchmark regression gate. Compares the FRESH raw results (written by bench-all.mjs) against the
// PREVIOUS row in bench/history.jsonl and fails (exit 1) on a regression. Policy (locked with the
// user): hard gate vs last + a catch-rate floor. The deterministic passes (OBSERVATION-COST + REPLAY)
// block; the AGENT-LOOP pass (a paid LLM loop) is never gated here.
// (Raw JSON keys keep the legacy A/B/C codes — ranLayerA, layer_c — for data continuity.)
//
//   node bench/harness/bench-all.mjs --full && node bench/harness/gate.mjs
//
// Hard fails:
//   - catch-rate < 1.0, or any false positive (OBSERVATION-COST — only when analysis.json is present)
//   - efficiency drops > VE_TOL vs the last row (OBSERVATION-COST)
//   - selector detection not full, or consequence detection not full (REPLAY)
//   - per-run replay tokens rise > TOKEN_TOL vs the last row (REPLAY)
import { readFileSync, existsSync } from 'node:fs';

const VE_TOL = 0.03; // VE may dip at most 3% vs last (noise) before it's a regression
const TOKEN_TOL = 0.05; // per-run replay tokens may rise at most 5% vs last

function readRaw(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

/** The previous recorded row (the baseline we must not regress against), or null on first run. */
function lastRow() {
  if (!existsSync('bench/history.jsonl')) return null;
  const lines = readFileSync('bench/history.jsonl', 'utf8').trim().split('\n').filter(Boolean);
  const last = lines.at(-1);
  return last !== undefined ? JSON.parse(last) : null;
}

/** Parse a "3/3" detection-rate string into { detected, total }. */
function parseRate(rate) {
  if (typeof rate !== 'string') return null;
  const m = /^(\d+)\/(\d+)$/.exec(rate);
  return m === null ? null : { detected: Number(m[1]), total: Number(m[2]) };
}

const failures = [];
const scorecard = [];
const prev = lastRow();

/**
 * Which dimensions were actually COMPARED against a baseline, and which had none to compare against.
 *
 * This gate used to end with "✓ gate passed — no regression vs the last baseline" whether or not a
 * single comparison had happened. It cannot happen today: every `layer_c` comparison reads
 * `prev.layer_c`, and the most recent `history.jsonl` row does not have that key — the last nine rows
 * do, the last row does not — so `lastC` is null, every `if (last !== null)` is skipped, and the gate
 * reports a clean bill of health having checked nothing but the absolute floors.
 *
 * A regression gate that cannot see a regression, announcing that it found none, is precisely the
 * false green this whole project exists to catch. So: count the comparisons, and say what was
 * actually compared. The absolute floors (detection must be full) still gate on their own.
 */
const compared = [];
const uncompared = [];
const note = (dimension, baseline) => {
  (baseline === null || baseline === undefined ? uncompared : compared).push(dimension);
};
// Only gate layers that ran THIS pass (a stale analysis.json must not be gated on a Layer-C pass).
const manifest = readRaw('bench/raw/bench-run.json');
const ranLayerA = manifest === null ? true : manifest.ranLayerA === true;

// ---- OBSERVATION-COST pass (scripted observation, "Layer A") — only when freshly run this pass ----
const analysis = ranLayerA ? readRaw('bench/raw/analysis.json') : null;
if (analysis !== null) {
  const reticle = analysis.per_tool?.reticle ?? {};
  const realRegressions = Object.values(analysis.per_scenario ?? {}).filter(
    (s) => s.expected_detect === true && s.by_tool?.reticle?.verdict !== 'NOT MEASURED',
  ).length;
  const rcr = realRegressions ? +(reticle.true_positives / realRegressions).toFixed(3) : null;
  const ve = reticle.avg_tokens_o200k
    ? +(reticle.true_positives / (reticle.avg_tokens_o200k / 1000)).toFixed(2)
    : null;
  const fp = reticle.false_positives ?? 0;

  if (rcr === null || rcr < 1.0) failures.push(`RCR floor: reticle RCR=${rcr} (must be 1.0)`);
  if (fp > 0) failures.push(`false positives: reticle FP=${fp} (must be 0)`);
  const lastVe = prev?.per_tool?.reticle?.ve ?? null;
  if (lastVe !== null && ve !== null && ve < lastVe * (1 - VE_TOL)) {
    failures.push(
      `VE regressed: ${ve} < ${lastVe} (−${(((lastVe - ve) / lastVe) * 100).toFixed(1)}%)`,
    );
  }
  scorecard.push(['Observe · catch-rate', prev?.per_tool?.reticle?.rcr ?? '—', rcr]);
  scorecard.push(['Observe · false-positives', '0', fp]);
  note('Observe · efficiency', lastVe);
  scorecard.push(['Observe · efficiency', lastVe ?? '—', ve]);
} else {
  scorecard.push(['Observation-cost', '—', 'not run this pass (advisory skip)']);
}

// ---- REPLAY pass (deterministic replay, "Layer C") — always gated when the raws are present ----
const cost = readRaw('bench/raw/replay-bench.json');
const selector = readRaw('bench/raw/replay-detect.json');
const consequence = readRaw('bench/raw/replay-detect-consequence.json');
const lastC = prev?.layer_c ?? null;

if (selector !== null) {
  const r = parseRate(selector.detection_rate);
  if (r === null || r.detected < r.total) {
    failures.push(`selector detection not full: ${selector.detection_rate}`);
  }
  const lastR = parseRate(lastC?.selector_detection);
  if (lastR !== null && r !== null && r.total < lastR.total) {
    failures.push(`selector scenarios dropped: ${r.total} < ${lastR.total}`);
  }
  note('Replay · selector', lastC?.selector_detection);
  scorecard.push(['Replay · selector', lastC?.selector_detection ?? '—', selector.detection_rate]);
}
if (consequence !== null) {
  const r = parseRate(consequence.detection_rate);
  if (r === null || r.detected < r.total) {
    failures.push(`consequence detection not full: ${consequence.detection_rate}`);
  }
  note('Replay · consequence', lastC?.consequence_detection);
  scorecard.push([
    'Replay · consequence',
    lastC?.consequence_detection ?? '—',
    consequence.detection_rate,
  ]);
}
const stateOracle = readRaw('bench/raw/replay-detect-state.json');
if (stateOracle !== null) {
  const r = parseRate(stateOracle.detection_rate);
  if (r === null || r.detected < r.total) {
    failures.push(`state-oracle detection not full: ${stateOracle.detection_rate}`);
  }
  const lastR = parseRate(lastC?.state_detection);
  if (lastR !== null && r !== null && r.total < lastR.total) {
    failures.push(`state-oracle scenarios dropped: ${r.total} < ${lastR.total}`);
  }
  note('Replay · state', lastC?.state_detection);
  scorecard.push(['Replay · state', lastC?.state_detection ?? '—', stateOracle.detection_rate]);
}
if (cost !== null) {
  const now = cost.per_run?.reticle_replay_mean_tokens ?? null;
  const last = lastC?.replay_mean_tokens ?? null;
  if (last !== null && now !== null && now > last * (1 + TOKEN_TOL)) {
    failures.push(
      `replay tokens rose: ${now} > ${last} (+${(((now - last) / last) * 100).toFixed(1)}%)`,
    );
  }
  note('Replay · tokens/run', last);
  scorecard.push(['Replay · tokens/run', last ?? '—', now]);
}

// ---- Report ----
console.log('\nBenchmark gate — fresh vs last baseline');
console.log('─'.repeat(56));
for (const [metric, was, now] of scorecard) {
  console.log(`  ${String(metric).padEnd(22)} ${String(was).padEnd(14)} → ${now}`);
}
console.log('─'.repeat(56));
if (analysis === null && cost === null && selector === null && consequence === null) {
  console.error('✗ no fresh results found — run `node bench/harness/bench-all.mjs` first.');
  process.exit(1);
}
if (failures.length > 0) {
  console.error(`\n✗ GATE FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// Say what was actually compared. "No regression" over zero comparisons is not a result.
if (uncompared.length > 0) {
  console.log(`\n⚠ ${uncompared.length} dimension(s) had NO baseline to compare against:`);
  for (const d of uncompared) console.log(`  - ${d}`);
  console.log(
    `  The last bench/history.jsonl row (${prev?.version ?? 'none'}, ${prev?.date ?? 'no date'}) does not carry these keys,\n` +
      '  so they were checked against absolute floors only — a regression WITHIN the floor is invisible.\n' +
      '  Record a fresh baseline with `node bench/harness/record.mjs` after a full pass.',
  );
}
console.log(
  0 === compared.length
    ? `\n✓ absolute floors hold — but NOTHING was compared against a baseline, so this run says nothing about regression.`
    : `\n✓ gate passed — ${compared.length} dimension(s) compared against the last baseline, no regression.`,
);
process.exit(0);
