/**
 * The completion gate — exits non-zero unless passing artifacts cover the flows affected by the changed
 * files. This is what makes verification unavoidable: an agent that edits a covered file cannot "finish"
 * without re-verifying. Flaky flows (B38) are quarantined — surfaced, never gate-blocking — because one
 * unexplained flake that blocks a merge destroys trust in the red. Pure decision; the CLI computes the
 * inputs (git diff → affected → run artifacts + flake ledger) and maps `pass` to the exit code.
 */

export interface GateInput {
  /** Flows that must be covered (from the affected index over the changed files). */
  affected: readonly string[];
  /** Flows that have a passing verification artifact. */
  passing: readonly string[];
  /** Flows currently quarantined as flaky — excluded from blocking. */
  flaky?: readonly string[];
}

export interface GateResult {
  /** True when every affected, non-flaky flow has a passing artifact. */
  pass: boolean;
  /** Affected flows with no passing artifact and not flaky — these block the gate. */
  uncovered: string[];
  /** Affected flows excluded only because they are quarantined flaky — surfaced, not blocking. */
  quarantined: string[];
}

export function gateDecision(input: GateInput): GateResult {
  const passing = new Set(input.passing);
  const flaky = new Set(input.flaky ?? []);
  const uncovered: string[] = [];
  const quarantined: string[] = [];
  for (const flow of input.affected) {
    if (passing.has(flow)) continue;
    if (flaky.has(flow)) quarantined.push(flow);
    else uncovered.push(flow);
  }
  return { pass: uncovered.length === 0, uncovered, quarantined };
}
