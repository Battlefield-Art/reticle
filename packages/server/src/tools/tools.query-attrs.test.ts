import { describe, expect, it } from 'vitest';
import type { CommandResult } from '@reticlehq/core';
import { TOOLS, type ToolDeps } from './tools.js';
import { ReticleTool } from './tool-names.js';
import type { Session, SessionManager } from '../session/session.js';

/**
 * The QUERY handler forwards an explicit ALLOWLIST of arguments to the browser, so a newly added
 * input is silently dropped unless it is also added there. That happened with `attrs`: the zod schema
 * accepted it, the browser implemented it, and every browser-side unit test passed — because those
 * call `matchQuery` directly. Only a live run revealed the field never crossed the wire.
 *
 * These tests pin the forwarding itself. A schema and an implementation are not the whole wire.
 */

/** Capture the args the tool hands to the session command. */
function depsCapturing(seen: { args?: Record<string, unknown> | undefined }): ToolDeps {
  const command = (_cmd: string, args?: Record<string, unknown>): Promise<CommandResult> => {
    seen.args = args;
    return Promise.resolve({ kind: 'command_result', id: 'c', ok: true, result: { elements: [] } });
  };
  const session: Partial<Session> = { id: 'demo', command };
  const sessions: Partial<SessionManager> = { resolve: () => session as Session };
  return { sessions: sessions as SessionManager } as unknown as ToolDeps;
}

const queryTool = () => {
  const tool = TOOLS.find((t) => t.name === ReticleTool.QUERY);
  if (tool === undefined) throw new Error('reticle_query is not on the surface');
  return tool;
};

describe('reticle_query argument forwarding', () => {
  it('forwards `attrs` to the browser — the field is useless if the handler drops it', async () => {
    const seen: { args?: Record<string, unknown> | undefined } = {};
    await queryTool().handler(depsCapturing(seen), {
      sessionId: 's1',
      by: 'role',
      value: 'link',
      attrs: ['href'],
    });
    expect(seen.args?.['attrs']).toEqual(['href']);
  });

  it('still forwards the pre-existing targeting arguments', async () => {
    const seen: { args?: Record<string, unknown> | undefined } = {};
    await queryTool().handler(depsCapturing(seen), {
      sessionId: 's1',
      by: 'testid',
      value: 'submit',
      name: 'Save',
      scope: '#main',
    });
    expect(seen.args).toMatchObject({
      by: 'testid',
      value: 'submit',
      name: 'Save',
      scope: '#main',
    });
  });

  it('omits `attrs` when the caller did not ask for it, so the browser keeps its default shape', async () => {
    const seen: { args?: Record<string, unknown> | undefined } = {};
    await queryTool().handler(depsCapturing(seen), { sessionId: 's1', by: 'role', value: 'button' });
    expect(seen.args?.['attrs']).toBeUndefined();
  });
});
