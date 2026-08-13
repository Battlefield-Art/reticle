/**
 * Both verdict paths must look at the same evidence for the same question.
 *
 * `reticle_act_and_wait` is the tool the product tells agents to reach for first — it is named in
 * the MCP handshake, in SKILL.md, and in the cheatsheet. `reticle_assert` is the other one. They
 * answer the same question and they were not reading the same inputs: `assert` passed `prior` to
 * the contradiction engine and `act_and_wait` did not.
 *
 * `prior` is what makes `unit-mismatch` possible — the money false green, where a total renders 100x
 * off because a value in minor units is displayed as major. A scale error disagrees with a value the
 * API stated EARLIER in the session, so an action-scoped window can never contain both halves. No
 * `prior`, no comparison, no finding.
 *
 * So the flagship detector could not fire on the flagship path, and nothing anywhere said so: the
 * finding was not suppressed or downgraded, it was simply never produced. That is the same shape as
 * the three wiring defects already fixed this release — a capability that exists, is tested, and
 * never reaches the caller.
 *
 * This pins the property rather than the plumbing: whatever the two paths pass, they must agree on
 * the inputs that decide which contradiction kinds are REACHABLE.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (file: string): string => readFileSync(join(import.meta.dirname, file), 'utf8');

describe('act_and_wait and assert see the same evidence', () => {
  const act = src('act-tools.ts');
  const assert = src('assert-verdict.ts');

  it('both paths pass `prior` to the contradiction engine', () => {
    // Without this on the act path, `unit-mismatch` cannot fire there at all.
    expect(act).toMatch(/findContradictions\([\s\S]{0,200}prior/);
    expect(assert).toMatch(/findContradictions\([\s\S]{0,120}prior/);
  });

  it('both compute `prior` as everything strictly before the window', () => {
    // Same definition on both sides — a `prior` that overlapped the window would let an event be
    // both the claim and the counter-evidence.
    const shape = /queryEvents\(\{ since: 0 \}\)\)\.filter\(\(e\) => e\.t < since\)/;
    expect(act).toMatch(shape);
    expect(assert).toMatch(shape);
  });

  it('act_and_wait still passes the action and its effect — prior is added, not swapped', () => {
    expect(act).toMatch(/findContradictions\([\s\S]{0,260}action: acted/);
    expect(act).toMatch(/findContradictions\([\s\S]{0,260}session\.lastAct\.effect\(\)/);
  });

  it('prior is documented as learning material, so nobody later attributes findings to it', () => {
    // Attribution must stay window-scoped on both paths: `prior` explains a value, it never sources
    // a finding. Stated in both files because the next person will read only one of them.
    expect(act).toMatch(/[Ll]earning material/);
    expect(assert).toMatch(/LEARNING material/);
  });
});
