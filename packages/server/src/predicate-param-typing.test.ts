/**
 * A numeric parameter advertised as a predicate object.
 *
 * Lean profiles replace the full predicate union with a compact description, because the union is
 * 72% of the advertised input schema and is re-sent every turn. The replacement picks its targets by
 * NAME: `PREDICATE_PARAMS = new Set(['predicate', 'until'])`.
 *
 * But `until` is overloaded on this surface. The act/assert family uses it for a predicate; the READ
 * family — reticle_observe, reticle_network, reticle_console — uses it for a NUMBER, an upper cursor
 * bound ("the span between two acts"). Under the DEFAULT hybrid profile all three were advertised to
 * the agent as `Predicate object: { kind, ...fields }`, typed as a record.
 *
 * An agent that believes the schema passes a predicate object, and the handler does
 * `asNumber(args['until'])` → undefined → the cursor bound is silently dropped and the tool answers
 * over the wrong window. A wrong answer that looks like an answer, which is the exact failure class
 * this product exists to catch.
 *
 * The fix is to key on the SCHEMA rather than the name: replace a parameter because it IS a
 * predicate, not because of what it is called.
 */

import { describe, expect, it } from 'vitest';
import { advertisedTools, advertisedConfig } from './mcp.js';
import { TOOL_PROFILE } from './tools/profiles.js';

const PREDICATE_MARKER = 'Predicate object';

/** Tools where `until` is a numeric cursor bound, not a predicate. */
const CURSOR_TOOLS = ['reticle_observe', 'reticle_network', 'reticle_console'];

describe('the lean profile does not retype a numeric parameter as a predicate', () => {
  const advertised = advertisedTools(TOOL_PROFILE.HYBRID);
  const describedAs = (toolName: string, param: string): string => {
    const tool = advertised.find((t) => t.name === toolName);
    if (tool === undefined) return '';
    const shape = advertisedConfig(tool, advertised, TOOL_PROFILE.HYBRID).inputSchema;
    return shape[param]?.description ?? '';
  };

  it.each(CURSOR_TOOLS)('%s.until is still described as a cursor bound', (toolName) => {
    const text = describedAs(toolName, 'until');
    expect(text, `${toolName}.until is advertised as a predicate`).not.toContain(PREDICATE_MARKER);
    expect(text.toLowerCase(), `${toolName}.until should say what it is`).toMatch(
      /cursor|bound|span/,
    );
  });

  it('while a REAL predicate parameter still gets the compact grammar', () => {
    // The saving this mechanism exists for must survive the fix.
    expect(describedAs('reticle_wait_for', 'predicate')).toContain(PREDICATE_MARKER);
    expect(describedAs('reticle_act_and_wait', 'until')).toContain(PREDICATE_MARKER);
  });
});
