import { afterAll, describe, it } from 'vitest';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { noInternalTags } from './no-internal-tags.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

/**
 * Every invalid case below is a real comment that shipped in this repo. Every valid case is prose the
 * rule must NOT punish — a rule that fires on ordinary technical writing gets disabled, and a disabled
 * rule enforces nothing.
 */
ruleTester.run('no-internal-tags', noInternalTags, {
  valid: [
    { code: '// Flush the journal tail so the last events reach disk.' },
    { code: '/** Welford M2 accumulator for streaming variance. */' },
    { code: '// Falls back to HTTP/2 when the server supports it.' },
    { code: '// Retries up to 3 times with linear backoff.' },
    { code: '// See the H2 heading in the rendered docs.' },
    { code: '// Matches UTF-8 encoded payloads only.' },
    // A version of a THIRD-PARTY thing is not an internal tracking string.
    { code: "// Requires @playwright/mcp 0.0.76 or newer." },
    // Test descriptions are scanned too, so ordinary ones must stay legal.
    { code: "describe('formatBuddyStatus', () => {});" },
    { code: "it('falls back to HTTP/2 when available', () => {});" },
  ],
  invalid: [
    {
      code: '/** The durable causal journal (v2.2.0 W2) */',
      errors: [{ messageId: 'internalTag' }, { messageId: 'internalTag' }],
    },
    { code: '// Blind-spot detection (B17, the detectable half)', errors: [{ messageId: 'internalTag' }] },
    { code: '// routing (§4.3) — the view renders but the URL is wrong', errors: [{ messageId: 'internalTag' }] },
    { code: '// Widened (W3)', errors: [{ messageId: 'internalTag' }] },
    { code: '// surface consolidation W10.3', errors: [{ messageId: 'internalTag' }] },
    { code: '// anti-reward-hacking (B37)', errors: [{ messageId: 'internalTag' }] },
    // The project rule names TEST DESCRIPTIONS explicitly, and these are real ones that survived a
    // repo-wide cleanup because a comment-only rule could not see a string literal.
    {
      code: "describe('gate — anti-reward-hacking (B37)', () => {});",
      errors: [{ messageId: 'internalTag' }],
    },
    {
      code: "describe('mergeTools (W10.3 surface consolidation)', () => {});",
      errors: [{ messageId: 'internalTag' }],
    },
    {
      code: "it('allows richer payloads (W4 will add fields)', () => {});",
      errors: [{ messageId: 'internalTag' }],
    },
  ],
});
