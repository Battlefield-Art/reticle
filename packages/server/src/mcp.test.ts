import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { encodeResult, withSessionEnvelope } from './mcp.js';
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
