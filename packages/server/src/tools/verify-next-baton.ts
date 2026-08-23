/**
 * The verdict nudge, as a call the agent can make rather than a sentence it has to translate.
 *
 * `verify_next` already fires when an agent has driven the page several times and asked for no
 * verdict, which is the commonest shape of a wasted session: almost every verdict-less session in
 * the field never called a verdict-producing tool once. What it carried was prose. Prose has to be
 * turned back into a call, and the translation is exactly where the agent was already going wrong —
 * `until` omitted, arguments flat instead of nested under `args`, a predicate written as a bare
 * array.
 *
 * So it carries the call. `ref` and `action` come from the act that actually dispatched, so the
 * suggestion is about the element the agent really touched rather than a worked example from a
 * document. `until` is deliberately left as a placeholder the agent must replace: naming the
 * consequence is the one part nothing but the agent can know, and filling it in with a guess would
 * be Reticle inventing the assertion — the failure `no-fault` exists to prevent.
 *
 * Emitted only when there is a real call to suggest. A baton with nothing behind it is the router
 * failure in miniature: an agent that follows a fabricated next step follows it confidently.
 */

import { ReticleTool } from './tool-names.js';

/** What the agent must supply itself. Phrased as an instruction so it cannot be sent verbatim. */
export const UNTIL_PLACEHOLDER = '<name the consequence this action causes>';

export interface VerifyNextBaton {
  /** The fact that produced this, in the agent's own terms. */
  why: string;
  /** A call, ready to make once `until` is filled in. */
  call?: { tool: string; args: Record<string, unknown> };
  /** Where the argument shapes are stated, on disk and version-exact rather than on the web. */
  docs?: string;
}

/**
 * Build the baton from what the session actually did.
 *
 * `ref` absent means no act dispatched under a ref this session — a navigation, or a run that only
 * read. There is then no honest call to name, so the prose stands alone rather than pointing at an
 * element nobody touched.
 */
export function verifyNextBaton(
  prose: string,
  lastAct: { action?: string | undefined; ref?: string | undefined },
): VerifyNextBaton {
  const { ref, action } = lastAct;
  if (ref === undefined || action === undefined) return { why: prose };
  return {
    why: prose,
    call: {
      tool: ReticleTool.ACT_AND_WAIT,
      args: { ref, action, until: { kind: 'text', value: UNTIL_PLACEHOLDER } },
    },
    docs: `reticle_tools { names: ["${ReticleTool.ACT_AND_WAIT}"] }`,
  };
}
