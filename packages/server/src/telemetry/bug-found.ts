/**
 * Counting the defects Reticle actually finds.
 *
 * Every other metric in this product measures whether Reticle is USED. This one measures whether it
 * WORKS — and it is the only number that can honestly be put in front of an investor or published,
 * because it counts outcomes for users rather than activity by them.
 *
 * It is read off tool RESULTS at the single chokepoint every tool already crosses, rather than
 * emitted from the four places that produce findings. That is deliberate: the detectors are pure
 * functions and should stay that way, and reading results means a fifth source of findings is covered
 * the day it starts returning one of these shapes, instead of the day someone remembers to instrument
 * it.
 *
 * What is sent is the KIND from Reticle's own findings vocabulary — `signal-contradicted`,
 * `console-error`, `duplicate-request`. Never a selector, a URL, an element, or a description of
 * anyone's app: that a class of defect was found, never what it was found in.
 */
import { ReticleTool } from '../tools/tool-names.js';
import { BugSource, ContradictionKind, type BugFound } from '@reticlehq/core';

/**
 * A defect as the CLASSIFIER sees it — everything except `repeat`.
 *
 * Whether a kind is new belongs to the session, and these detectors are pure functions that know
 * nothing about sessions and should stay that way. The emission site owns the dedup flag.
 */
export type BugCandidate = Omit<BugFound, 'repeat'>;

/** Cap per tool call — a pathological crawl must not turn one call into a thousand events. */
const MAX_BUGS_PER_CALL = 25;

interface Anomaly {
  kind?: unknown;
}

function kindsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const kind = (entry as Anomaly)?.kind;
      return 'string' === typeof kind ? kind : undefined;
    })
    .filter((kind): kind is string => kind !== undefined);
}

/**
 * The defects in one tool result.
 *
 * Ordering matters for the false-green flag: a contradiction found alongside a PASSING assertion is
 * the case the product exists for — the screen looked right, the write failed, and every other tool
 * on the market would have called it green. That pairing is what `falseGreen` marks.
 */
/**
 * The verdict this result carries, whatever envelope it arrived in.
 *
 * `reticle_assert` reports a top-level boolean `pass`. `reticle_act_and_wait` — the tool agents
 * actually reach for, and the one whose description calls it the act->observe->assert loop — reports
 * `verdict.pass` with the summary at `verified`. Reading only `result.pass` meant a FAILED
 * act_and_wait produced no bug at all, and a contradiction found next to a PASSING one was recorded
 * with `falseGreen: false` — deflating the single number this product exists to publish, by the
 * shape of its own envelope.
 */
function verdictOf(result: Record<string, unknown>): boolean | undefined {
  if ('boolean' === typeof result['pass']) return result['pass'];
  const verdict = result['verdict'];
  if ('object' === typeof verdict && verdict !== null) {
    const nested = (verdict as Record<string, unknown>)['pass'];
    if ('boolean' === typeof nested) return nested;
  }
  // `verified` is the field the agent is told to gate on; "unknown" is deliberately not a verdict.
  const verified = result['verified'];
  if ('yes' === verified) return true;
  if ('no' === verified) return false;
  return undefined;
}

/** The assertion label, from either envelope — act_and_wait nests it under `verdict`. */
function assertionOf(result: Record<string, unknown>): unknown {
  if (result['assertion'] !== undefined) return result['assertion'];
  const verdict = result['verdict'];
  return 'object' === typeof verdict && verdict !== null
    ? (verdict as Record<string, unknown>)['assertion']
    : undefined;
}

/**
 * A verdict that could not be reached is not a defect found. `inconclusive` is set when the
 * assertion was never evaluated — an under-specified call, or nothing instrumented to read — so
 * counting it would put the agent's own mistakes into the number we publish.
 */
function isInconclusive(result: Record<string, unknown>): boolean {
  const verdict = result['verdict'];
  return (
    'object' === typeof verdict &&
    verdict !== null &&
    'string' === typeof (verdict as Record<string, unknown>)['inconclusive']
  );
}

/** A suite row whose replay never STARTED — see SuiteFlowResult.couldNotRun. */
function couldNotRun(failure: unknown): boolean {
  return (
    'object' === typeof failure &&
    failure !== null &&
    true === (failure as { couldNotRun?: unknown }).couldNotRun
  );
}

/**
 * `bug.attribution` was REMOVED, deliberately, and this note is here so it is not re-added casually.
 *
 * It shipped twice and was wrong both times. First it stamped `app` on every contradiction, including
 * `request-never-settled` — which Reticle raises from the ABSENCE of a settle event, so a dev-overlay
 * poll manufactured it with the app doing nothing wrong. That was fixed, and a real drive then found
 * it still inverted: across two full runs, EVERY `attribution: 'app'` was a misattribution, while the
 * one defect that genuinely was a bad agent predicate carried none. One session would have published
 * "2 defects in the app" against a true count of 0.
 *
 * A metric that is confidently wrong about WHOSE fault a defect is, is worse than no metric: it is
 * the number a founder steers on, and it points at the customer. Counting nothing is recoverable;
 * publishing a false accusation about somebody's product is not.
 *
 * Bringing it back needs evidence that actually separates the cases. It does not exist in the payload
 * today: `element.present` covers "the button is missing", "the API is down" and "the agent mistyped
 * a testid" identically, and `signal.absent` covers both a signal the app never fired and a ref
 * Reticle drove into nothing. Until a verdict carries the reason it came out that way, the honest
 * output is no owner at all.
 */

export function bugsInResult(toolName: string, result: Record<string, unknown>): BugCandidate[] {
  // `reticle_run` is a WRAPPER: its handler calls runTool on the real tool, which already reported
  // that result's defects under the real tool's name — then the outer chokepoint reports the very
  // same object again as `reticle_run`. One sweep of 34 events was a perfect mirror image:
  // flow-regression x8/reticle_flow_verify AND x8/reticle_run; assertion-failed x8/reticle_verify_change
  // AND x8/reticle_run. Sixteen of the thirty-four were echoes, and a headline number that doubles
  // because of HOW a tool was reached is not a measurement.
  //
  // Nothing is lost by staying silent here: when the inner tool refuses or throws, the wrapper
  // returns { error, tool, params, hint }, which carries no verdict and no failures to classify.
  if (toolName === ReticleTool.RUN) return [];
  const bugs: BugCandidate[] = [];
  const verdict = verdictOf(result);
  const passed = true === verdict;

  // 1. Contradictions — channels disagreeing. Invisible to a human watching the screen.
  for (const kind of kindsOf(result['contradictions'])) {
    // A contradiction is two of the APP's own channels disagreeing — never the agent's phrasing.
    // Omitted for the one kind Reticle can produce on its own: see contradictionAttribution.
    bugs.push({
      source: BugSource.CONTRADICTION,
      kind,
      falseGreen: passed,
      tool: toolName,
    });
  }

  // 2. Crawl anomalies — found autonomously, with nobody writing a test. Crawl reports its own
  //    contradictions inside `anomalies` too, so classify by kind rather than by which array it sat in.
  for (const kind of kindsOf(result['anomalies'])) {
    // Crawl reports contradictions in this array too, so the same kind must get the same owner
    // wherever it arrives — a `request-never-settled` found by the crawler is no better evidence
    // about whose fault it was than one found by an assertion.
    bugs.push({
      source: BugSource.CRAWL,
      kind,
      // A crawl contradiction presents as success too — the click looked fine and its write did not
      // — even though no assertion was made. See the definition on `falseGreen`.
      falseGreen: CONTRADICTION_KINDS.has(kind),
      tool: toolName,
      // Nobody wrote a predicate here, so there is no bad request to blame: a crawl anomaly is a
      // fault the app produced on its own.
    });
  }

  // 3. A failed assertion — the agent declared a consequence and it did not hold.
  //    Only when nothing above already explained it, or one defect would be counted twice.
  // A red the APP earned, not one Reticle produced. `verified: "unknown"` is the honesty layer
  // saying nothing was proved either way, and a top-level `error` is a refusal — measured over one
  // sweep, every bug_found emitted was one of these two: "no session connected" from reticle_run and
  // an unverifiable suite from reticle_verify_change, counted as defects in the user's app.
  const reticleFailure = 'unknown' === result['verified'] || 'string' === typeof result['error'];
  if (false === verdict && 0 === bugs.length && !isInconclusive(result) && !reticleFailure) {
    const reason = assertionOf(result);
    const kind =
      'string' === typeof reason && reason.length > 0 ? reason.slice(0, 64) : 'assertion-failed';
    bugs.push({
      source: BugSource.ASSERTION,
      kind,
      falseGreen: false,
      tool: toolName,
      // Omitted when the label cannot say whose fault it was — see ASSERTION_ATTRIBUTION.
    });
  }

  // 4. Replay failures — a saved flow that used to pass no longer does. That is a regression caught,
  //    which is a different and stronger claim than "a check failed".
  if ('fail' === result['status'] && Array.isArray(result['failures'])) {
    for (const failure of result['failures'].slice(0, MAX_BUGS_PER_CALL)) {
      // A suite that failed because nothing could RUN is not a regression in the user's app. This
      // rule never looked past `status`, so a project whose flow files did not resolve reported one
      // "defect found" per flow — Reticle's own failure, published as the customer's.
      if (couldNotRun(failure)) continue;
      bugs.push({
        source: BugSource.REPLAY,
        kind: 'flow-regression',
        falseGreen: false,
        tool: toolName,
        // A saved flow that used to pass and no longer does is a regression in the app. Rows that
        // never RAN are skipped above precisely so Reticle's own failures do not land here.
      });
    }
  }

  return bugs.slice(0, MAX_BUGS_PER_CALL);
}

/**
 * Crawl anomaly kinds that are CONTRADICTIONS rather than single-channel faults.
 *
 * `reticle_crawl` returns both classes in one `anomalies` array — a console error is one channel
 * complaining, while a UI that advanced over a failed write is two channels disagreeing. Only the
 * second presents as success, and collapsing them would inflate the one claim that has to be exact.
 *
 * DERIVED from core's `ContradictionKind`, never hand-listed. The first version copied the twelve
 * strings into a literal here, which matched on the day it was written and would have silently
 * misclassified the thirteenth: a new contradiction kind would have been counted as an ordinary
 * fault, quietly deflating the exact number we intend to publish. A copied enum is a drift hazard
 * wherever it appears; it is a correctness hazard when the thing that drifts is a public claim.
 */
const CONTRADICTION_KINDS: ReadonlySet<string> = new Set(Object.values(ContradictionKind));
