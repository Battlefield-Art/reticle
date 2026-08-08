/**
 * Which tool results count as a completed verification, as one pure rule.
 *
 * It used to live inline in `runTool` and read `status === 'pass'`, mapping everything else to
 * "no verdict". That was wrong in both directions at once, and the shape of the error is visible in
 * the production data:
 *
 *   - a FAILING suite emitted nothing, so `verification_completed` only ever fired on greens while
 *     `bugsInResult` fired on the reds — bugs with no verifications to divide them by;
 *   - an EMPTY suite ("all 0 flows pass") emitted `verified: yes, passed: true`.
 *
 * Extracted because a rule this easy to get wrong, feeding the one number shown to investors, should
 * be readable and testable on its own rather than inferred from a ternary inside a dispatcher.
 */
import { type Verification } from '@reticlehq/core';
import { VERIFICATION_TOOLS } from '../tools/feedback-tools.js';

/** Suite statuses. `unverifiable` is a suite that ran but proved nothing — including an empty one. */
const SuiteStatus = {
  PASS: 'pass',
  FAIL: 'fail',
} as const;

/**
 * The verification payload for a result, or undefined when nothing was verified.
 *
 * `falseGreenCaught` is the one that matters: the assertion PASSED and Reticle still refused to call
 * it verified. That is the product's thesis reduced to a boolean.
 */
export function verificationOf(
  toolName: string,
  result: Record<string, unknown>,
  durationMs: number,
): Verification | undefined {
  if (!VERIFICATION_TOOLS.has(toolName)) return undefined;
  const verified = typeof result['verified'] === 'string' ? result['verified'] : undefined;
  // flow_verify reports `status: pass|fail|unverifiable`; assert reports a boolean `pass`. Accept
  // either shape so the whole family is covered without normalizing four tools' contracts for a
  // metric's convenience — but a status that is neither pass nor fail is NOT a verdict, and an empty
  // suite reports exactly that.
  const status = result['status'];
  const passed =
    typeof result['pass'] === 'boolean'
      ? result['pass']
      : status === SuiteStatus.PASS
        ? true
        : status === SuiteStatus.FAIL
          ? false
          : undefined;
  if (verified === undefined && passed === undefined) return undefined;
  return {
    via: toolName,
    verified: verified ?? (passed === true ? 'yes' : 'no'),
    passed: passed ?? verified === 'yes',
    falseGreenCaught: passed === true && verified === 'no',
    durationMs,
  };
}
