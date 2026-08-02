import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  advertisedConfig,
  advertisedTools,
  encodeResult,
  firstSentence,
  withSessionEnvelope,
} from './mcp.js';
import { TOOL_PROFILE } from './tools/profiles.js';
import { TOOLS } from './tools/tools.js';
import { SESSION_BOUND_TOOLS } from './tools/invoke-tool.js';
import { ReticleTool } from './tools/tool-names.js';

describe('withSessionEnvelope — spliced fields survive structuredContent validation', () => {
  // `warning` rides with `session` from healthEnvelope on a throttled tab — it is spliced by runTool
  // exactly like the others, so the superset guard must cover it or a throttled tab's warning is
  // stripped on validating profiles from every session-bound tool but the one that declared it locally.
  const ENVELOPE_KEYS = ['session', 'session_lease', 'session_age_warning', 'control', 'warning'];

  it('every session-bound tool with an outputSchema declares the envelope fields (superset guard)', () => {
    for (const tool of TOOLS) {
      if (tool.outputSchema === undefined || !SESSION_BOUND_TOOLS.has(tool.name)) continue;
      const merged = withSessionEnvelope(tool.name, tool.outputSchema) ?? {};
      for (const key of ENVELOPE_KEYS) {
        expect(Object.keys(merged), `${tool.name} must keep '${key}'`).toContain(key);
      }
    }
  });

  it("keeps a tool's own field shape over the permissive envelope default (ACT session)", () => {
    const act = TOOLS.find((t) => t.name === ReticleTool.ACT);
    const merged = withSessionEnvelope(ReticleTool.ACT, act?.outputSchema) ?? {};
    // ACT declares a typed session object; the merge must not overwrite it with z.unknown.
    expect(merged['session']).toBe(act?.outputSchema?.['session']);
  });

  it('leaves a non-session-bound tool schema untouched', () => {
    const shape: z.ZodRawShape = { ok: z.boolean() };
    expect(withSessionEnvelope('not_a_session_tool', shape)).toBe(shape);
  });
});

describe('outputSchema declares every field its handler returns (field-drop guard)', () => {
  // The structuredContent-vs-outputSchema drop: on a validating profile (full/dynamic) the SDK strips
  // any returned key the schema does not declare. Each entry pins a field the handler is KNOWN to
  // return so a future schema edit that drops it fails here instead of silently vanishing from the
  // agent's view. This is the per-field backlog of the systematic returned-keys ⊆ declared-keys guard.
  const REQUIRED_FIELDS: Array<[string, string[]]> = [
    [ReticleTool.OBSERVE, ['window_ms']],
    [ReticleTool.FLOW_REPLAY, ['name']],
    [ReticleTool.ACT_AND_WAIT, ['source', 'capsuleSaved', 'paused', 'guidance', 'hint']],
    [ReticleTool.ACT, ['paused', 'guidance', 'hint']],
    [ReticleTool.ACT_SEQUENCE, ['paused', 'guidance', 'hint']],
    [ReticleTool.CAPABILITIES, ['generatedAt', 'governance']],
  ];
  for (const [name, fields] of REQUIRED_FIELDS) {
    it(`${name} declares ${fields.join(', ')}`, () => {
      const tool = TOOLS.find((t) => t.name === name);
      const keys = Object.keys(tool?.outputSchema ?? {});
      for (const f of fields) {
        expect(
          keys,
          `${name} outputSchema must declare '${f}' or it is stripped on validating profiles`,
        ).toContain(f);
      }
    });
  }
});

describe('encodeResult', () => {
  const result = { calls: [{ method: 'GET', url: '/api/x', status: 500 }] };

  it('defaults to compact JSON (no indentation whitespace)', () => {
    const text = encodeResult(result, '');
    expect(text).toBe('{"calls":[{"method":"GET","url":"/api/x","status":500}]}');
    expect(text).not.toContain('\n');
  });

  it('compact is strictly smaller than the pretty form for a structured payload', () => {
    expect(encodeResult(result, '').length).toBeLessThan(encodeResult(result, 'pretty').length);
  });

  it('opts back into indented JSON with encoding "pretty"', () => {
    const text = encodeResult(result, 'pretty');
    expect(text).toBe(JSON.stringify(result, null, 2));
    expect(text).toContain('\n');
  });

  it('round-trips to the same value regardless of encoding', () => {
    expect(JSON.parse(encodeResult(result, ''))).toEqual(result);
    expect(JSON.parse(encodeResult(result, 'pretty'))).toEqual(result);
  });
});

describe('lean profiles drop the advertised outputSchema without losing structuredContent', () => {
  // The schema-tax reduction rests on ONE SDK guarantee: a tool registered with no outputSchema still
  // delivers its structuredContent. If a future SDK bump breaks that, dropping the schema on lean
  // profiles would silently strip the typed object an agent might rely on — a false-green-shaped
  // regression — so the guarantee is pinned here rather than assumed. In-memory, no daemon, fast gate.
  it('the SDK carries structuredContent for a tool declared WITHOUT an outputSchema', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');

    const server = new McpServer({ name: 'test', version: '0' });
    server.registerTool('noschema', { description: 'x' }, () => ({
      content: [{ type: 'text' as const, text: '{"a":1,"b":2}' }],
      structuredContent: { a: 1, b: 2 },
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'c', version: '0' });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    const tool = listed.tools.find((t) => t.name === 'noschema');
    expect(tool?.outputSchema).toBeUndefined(); // nothing advertised → no schema tax

    const result = await client.callTool({ name: 'noschema', arguments: {} });
    expect(result.structuredContent).toEqual({ a: 1, b: 2 }); // …yet the typed object still arrives
    await client.close();
    await server.close();
  });
});

/**
 * Lean profiles trim each description to its first sentence, and the splitter looked for the first
 * `". "`. "e.g. " satisfies that, so every description carrying an example was cut off inside the
 * abbreviation — `reticle_act`'s ref reached the agent as "…reticle_query (e.g." and stopped, losing
 * both the example and the ref-lifetime contract stated after it. It degraded only the DEFAULT
 * profile, which is the one whose raw strings nobody reads.
 *
 * These call `firstSentence` directly. The first version of this test read the tool definitions
 * instead, which are trimmed LATER during registration — so it exercised none of the trimming and
 * would have passed with the bug fully present. A guard that cannot fail is worse than no guard.
 */
describe('firstSentence does not cut inside an abbreviation', () => {
  it('keeps the text that follows "e.g."', () => {
    const trimmed = firstSentence(
      "Element ref (e.g. 'e42') from reticle_snapshot — stable until the element leaves the DOM.",
    );
    expect(trimmed).toContain("e.g. 'e42'");
    expect(trimmed).toContain('leaves the DOM');
  });

  it.each(['i.e.', 'etc.', 'vs.', 'cf.'])('does not stop at "%s"', (abbr) => {
    expect(firstSentence(`Alpha ${abbr} beta gamma.`)).toContain('gamma');
  });

  it('still stops at a real sentence end', () => {
    expect(firstSentence('First one. Second one.')).toBe('First one.');
  });

  /**
   * A description may legitimately END on an abbreviation ("GET | POST | … etc."). What must never
   * happen is TRIMMING creating one, so this only flags text the trim actually shortened.
   */
  it.each(advertisedTools(TOOL_PROFILE.HYBRID).map((tool) => [tool.name, tool] as const))(
    '%s: trimming never creates a dangling abbreviation',
    (_name, tool) => {
      const texts = [
        tool.description,
        ...Object.values(tool.inputSchema).map((s) => s.description ?? ''),
      ].filter((text) => text.length > 0);
      for (const text of texts) {
        const trimmed = firstSentence(text);
        if (trimmed === text) continue;
        expect(trimmed.trimEnd()).not.toMatch(/\b(e\.g|i\.e|etc|vs|cf)\.$/);
      }
    },
  );
});

/**
 * The predicate grammar is 211 B and rode on SIX advertised tools — 1,266 B, 23% of all parameter
 * prose, re-sent every turn to state one thing six times. It is now spelled out once and referenced
 * after that. Both halves matter: drop the full grammar and the agent cannot write a predicate at
 * all; keep six copies and every turn pays for five of them.
 */
describe('the predicate grammar is stated once per turn, not six times', () => {
  const advertised = advertisedTools(TOOL_PROFILE.HYBRID);
  const withPredicate = advertised.filter((tool) =>
    Object.keys(tool.inputSchema).some((k) => k === 'predicate' || k === 'until'),
  );

  it('has several predicate-bearing tools (otherwise this proves nothing)', () => {
    expect(withPredicate.length).toBeGreaterThan(1);
  });

  /** The REAL advertised text, via the same builder registration uses. */
  const predicateTexts = (): string[] =>
    advertised.flatMap((tool) =>
      Object.entries(advertisedConfig(tool, advertised, TOOL_PROFILE.HYBRID).inputSchema)
        .filter(([key]) => key === 'predicate' || key === 'until')
        .map(([, schema]) => schema.description ?? ''),
    );

  it('spells the full kind list exactly once across the advertised surface', () => {
    expect(predicateTexts().filter((d) => d.includes('allOf | anyOf | not'))).toHaveLength(1);
  });

  it('points every other predicate parameter at the one that has it', () => {
    expect(predicateTexts().filter((d) => d.includes('same grammar as')).length).toBe(
      withPredicate.length - 1,
    );
  });

  it('still names a real advertised tool in the cross-reference', () => {
    const names = new Set(advertised.map((tool) => tool.name));
    for (const text of predicateTexts().filter((d) => d.includes('same grammar as'))) {
      const named = /same grammar as (reticle_[a-z_]+)/.exec(text)?.[1] ?? '';
      expect(names, `${named} is referenced but not advertised`).toContain(named);
    }
  });
});
