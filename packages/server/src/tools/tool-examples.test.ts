import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS } from './tools.js';
import { CORE_TOOL_NAMES } from './profiles.js';

/**
 * Examples are the fix for the one failure an agent cannot recover from on its own.
 *
 * A tool schema names the FIELDS; it does not say how they compose, and under the lean profiles only
 * the first sentence of the description survives. So an agent reads "execute one action against a
 * ref" and guesses `{ action: 'click', testid: 'x' }`. That guess is rejected inside the MCP SDK's
 * validation — before any of this package's error handling runs — so the reply is a raw zod dump
 * naming no field and showing no correct shape. The agent guesses again.
 *
 * Which makes a WRONG example strictly worse than none: it would teach the mistake with authority.
 * So each one is parsed against its own inputSchema here.
 */
describe('every advertised example is a call that would actually succeed', () => {
  const withExamples = TOOLS.filter((tool) => tool.example !== undefined);

  it('has examples to check', () => {
    expect(withExamples.length).toBeGreaterThan(0);
  });

  it.each(withExamples.map((tool) => [tool.name, tool] as const))(
    '%s: its example validates against its own inputSchema',
    (_name, tool) => {
      const parsed = z.object(tool.inputSchema).partial().safeParse(tool.example);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
    },
  );

  /**
   * Only mentioning fields the tool actually declares. A stray key parses fine (zod objects are not
   * strict here) while teaching the agent a field that does nothing — a silent lie with a green test.
   */
  it.each(withExamples.map((tool) => [tool.name, tool] as const))(
    '%s: its example uses only declared fields',
    (_name, tool) => {
      const declared = Object.keys(tool.inputSchema);
      for (const key of Object.keys(tool.example ?? {})) {
        expect(declared, `${key} is not a field of this tool`).toContain(key);
      }
    },
  );
});

/**
 * The core set is what a lean profile advertises, so it is where a guess is most likely and most
 * expensive — the description is trimmed hardest exactly there.
 */
describe('the core surface leaves nothing to guess', () => {
  const needExamples = TOOLS.filter(
    (tool) => CORE_TOOL_NAMES.has(tool.name) && Object.keys(tool.inputSchema).length > 1,
  );

  it.each(needExamples.map((tool) => [tool.name, tool] as const))(
    '%s carries an example call',
    (_name, tool) => {
      expect(tool.example).toBeDefined();
    },
  );
});
