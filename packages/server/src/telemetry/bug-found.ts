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
      return typeof kind === 'string' ? kind : undefined;
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
export function bugsInResult(toolName: string, result: Record<string, unknown>): BugCandidate[] {
  const bugs: BugCandidate[] = [];
  const passed = result['pass'] === true;

  // 1. Contradictions — channels disagreeing. Invisible to a human watching the screen.
  for (const kind of kindsOf(result['contradictions'])) {
    bugs.push({ source: BugSource.CONTRADICTION, kind, falseGreen: passed, tool: toolName });
  }

  // 2. Crawl anomalies — found autonomously, with nobody writing a test. Crawl reports its own
  //    contradictions inside `anomalies` too, so classify by kind rather than by which array it sat in.
  for (const kind of kindsOf(result['anomalies'])) {
    bugs.push({
      source: BugSource.CRAWL,
      kind,
      // A crawl contradiction presents as success too — the click looked fine and its write did not
      // — even though no assertion was made. See the definition on `falseGreen`.
      falseGreen: CONTRADICTION_KINDS.has(kind),
      tool: toolName,
    });
  }

  // 3. A failed assertion — the agent declared a consequence and it did not hold.
  //    Only when nothing above already explained it, or one defect would be counted twice.
  if (result['pass'] === false && bugs.length === 0) {
    const reason = result['assertion'];
    bugs.push({
      source: BugSource.ASSERTION,
      kind:
        typeof reason === 'string' && reason.length > 0 ? reason.slice(0, 64) : 'assertion-failed',
      falseGreen: false,
      tool: toolName,
    });
  }

  // 4. Replay failures — a saved flow that used to pass no longer does. That is a regression caught,
  //    which is a different and stronger claim than "a check failed".
  if (result['status'] === 'fail' && Array.isArray(result['failures'])) {
    for (const _failure of result['failures'].slice(0, MAX_BUGS_PER_CALL)) {
      bugs.push({
        source: BugSource.REPLAY,
        kind: 'flow-regression',
        falseGreen: false,
        tool: toolName,
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
