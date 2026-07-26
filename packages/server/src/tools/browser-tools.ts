import { z } from 'zod';
import { ReticleCommand } from '@reticlehq/core';
import { ReticleTool } from './tool-names.js';
import { asString } from './tools-helpers.js';
import { sessionIdShape, commandOrThrow } from './tool-kit.js';
import type { ToolDef } from './tools.js';

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.NAVIGATE,
    description:
      'Navigate the connected browser tab to a URL, or reload it in place with { reload: true } (add { hard: true } to bypass the cache). The SDK reconnects automatically after the page loads. Use reticle_sessions to confirm the new tab is connected before acting.',
    inputSchema: {
      url: z.string().optional().describe('The URL to navigate to. Omit when using reload.'),
      reload: z
        .boolean()
        .optional()
        .describe('Reload the current page instead of navigating (replaces reticle_refresh).'),
      hard: z
        .boolean()
        .optional()
        .describe('With reload:true, bypass the browser cache (Cmd+Shift+R). Default: false.'),
      ...sessionIdShape,
    },
    outputSchema: {
      ok: z.boolean(),
      url: z.string().optional(),
      reason: z.string().optional(),
    },
    handler: async (deps, args) => {
      // reload:true is the absorbed reticle_refresh — same command, one fewer advertised tool.
      if (args['reload'] === true) {
        await commandOrThrow(deps, asString(args['sessionId']), ReticleCommand.REFRESH, {
          hard: args['hard'] === true,
        });
        return { ok: true };
      }
      const url = asString(args['url']);
      if (url === undefined || url.length === 0) return { ok: false, reason: 'url required' };
      // Record navigate as an action. Its window is usually empty (the page unloads and the SDK
      // reconnects), but the action record itself — "navigated to X" — is the causal fact worth keeping.
      const session = deps.sessions.resolve(asString(args['sessionId']));
      session.beginAction(ReticleTool.NAVIGATE, { url });
      try {
        const result = (await commandOrThrow(
          deps,
          asString(args['sessionId']),
          ReticleCommand.NAVIGATE,
          { url },
        )) as { ok?: unknown; url?: unknown; reason?: unknown };
        return {
          ok: result.ok === true,
          ...(typeof result.url === 'string' ? { url: result.url } : {}),
          ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
        };
      } finally {
        session.finishAction();
      }
    },
  },
  {
    name: ReticleTool.REFRESH,
    description:
      'Reload the connected browser tab. Pass { hard: true } to bypass the browser cache (equivalent to Cmd+Shift+R). The SDK reconnects automatically after the reload.',
    inputSchema: {
      hard: z
        .boolean()
        .optional()
        .describe('Set true to bypass the browser cache. Default: false (normal reload).'),
      ...sessionIdShape,
    },
    outputSchema: {
      ok: z.boolean(),
    },
    handler: async (deps, args) => {
      await commandOrThrow(deps, asString(args['sessionId']), ReticleCommand.REFRESH, {
        hard: args['hard'] === true,
      });
      return { ok: true };
    },
  },
];
