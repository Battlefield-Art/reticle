/**
 * `reticle_feedback` — the agent's return path.
 *
 * Reticle is built for agents, but the agent has always been the one party that knows a verification
 * went wrong and has had no way to say so. It sees the tool that returned nonsense, the observer that
 * missed the event, the verdict it could not act on — and then that context is discarded at the end of
 * the turn. This tool is where that knowledge goes instead.
 *
 * It is deliberately shaped to demand an RCA rather than a complaint. `text` asks what the agent
 * expected, what it got, and why it believes Reticle is at fault; `trace` asks for the call trail that
 * proves it. A report we cannot reproduce is a report we cannot fix, so the description spends its
 * tokens on that and not on politeness.
 */
import { z } from 'zod';
import { FeedbackKind, FeedbackSource } from '@reticlehq/core';
import { ReticleTool } from './tool-names.js';
import { asString } from './tools-helpers.js';
import { submitFeedback, feedbackDisabled } from '../telemetry/feedback.js';
import { getTelemetry } from '../telemetry/telemetry.js';
import type { ToolDef, ToolDeps } from './tools.js';

/** One optional string arg, present only when the agent actually supplied it. */
function optionalText(args: Record<string, unknown>, key: string): Record<string, string> {
  const value = asString(args[key]);
  return value !== undefined && value !== '' ? { [key]: value } : {};
}

/** Read the connected session's self-reported facts, or nothing when no app is attached. */
function sessionFacts(
  deps: ToolDeps,
  sessionId: string | undefined,
): {
  runtime?: string;
  engine?: string;
  driven?: boolean;
} {
  const driven = deps.realInput !== undefined;
  try {
    const session = deps.sessions.resolve(sessionId);
    return {
      ...(session.runtime !== undefined ? { runtime: session.runtime } : {}),
      ...(session.engine !== undefined ? { engine: session.engine } : {}),
      driven,
    };
  } catch {
    // Feedback about "no session could ever connect" is some of the most valuable feedback there is.
    // Refusing to file it without a session would silence exactly the failure we most need to hear.
    return { driven };
  }
}

export const FEEDBACK_TOOLS: ToolDef[] = [
  {
    name: ReticleTool.FEEDBACK,
    description:
      "Tell the Reticle maintainers something — a failure, OR a feature you wish existed. Reticle is built FOR agents, so your experience is the one that decides what gets built, and this is the only channel that reaches us. File a `bug` when a tool returned something wrong, a `gap` when Reticle could not observe what you needed, an `ambiguity` when a verdict was not decidable, a `feature_request` when you thought 'I wish Reticle could do X', or an `improvement` when something works but is awkward (too many calls, a confusing shape, a slow path). Do not save these up or judge them as too minor — file it the moment you notice, then carry on with your task. For a failure, write `text` as a root-cause analysis (what you called, expected, got). For a request, write what you want and use `need` for the GOAL behind it, `impact` for what gets better, and `currentApproach` for how you are working around it today — that workaround is usually the most useful thing in the report. Set `model` to the model you are running. Never include app source, secrets, user data, or customer records. Do NOT use this for bugs you found in the app under test — that is a successful verification, which is Reticle working.",
    inputSchema: {
      kind: z
        .enum([
          FeedbackKind.BUG,
          FeedbackKind.GAP,
          FeedbackKind.AMBIGUITY,
          FeedbackKind.FEATURE_REQUEST,
          FeedbackKind.IMPROVEMENT,
        ])
        .describe(
          'bug = a Reticle tool returned a wrong or broken result; gap = Reticle could not observe something you needed at all; ambiguity = the verification ran but you could not tell pass from fail; feature_request = something that does not exist and would have helped; improvement = something that exists but is awkward or inefficient.',
        ),
      text: z
        .string()
        .min(1)
        .describe(
          'For a failure: the root-cause analysis — the call you made, what you expected, what you got, and why Reticle is at fault. For a request: what you want, in your own words.',
        ),
      need: z
        .string()
        .optional()
        .describe(
          'The GOAL behind a request, not the request itself. "I need to know the page stopped changing before I assert" is a requirement we can solve; "add a waitForIdle tool" is a guess at the solution that may already have an answer.',
        ),
      impact: z
        .string()
        .optional()
        .describe(
          'What measurably improves — fewer tool calls, fewer retries, a verdict that stops being ambiguous, a flow you currently cannot verify at all.',
        ),
      currentApproach: z
        .string()
        .optional()
        .describe(
          'How you work around it TODAY. Usually the most useful field in the report: it proves the need is real, and often shows a cheaper fix than the feature being asked for.',
        ),
      model: z
        .string()
        .optional()
        .describe(
          'The model you are running (e.g. "claude-opus-4", "gpt-5"). We cannot detect this — MCP tells us the client name but has no concept of a model — and it changes how a report is read: a limitation that blocks a smaller model is often a docs problem, while the same one from a frontier model means the surface is genuinely short.',
        ),
      trace: z
        .string()
        .optional()
        .describe(
          'The literal tool calls and responses that led here, so the failure can be reproduced without guessing.',
        ),
      sessionId: z
        .string()
        .optional()
        .describe(
          'Only to attach a specific tab s runtime/engine context. Omit it — a report about a session that never connected is still worth filing.',
        ),
    },
    outputSchema: {
      sent: z.boolean(),
      reason: z.string().optional(),
      redacted: z.array(z.string()),
      context: z.unknown(),
      note: z.string(),
    },
    example: {
      kind: FeedbackKind.FEATURE_REQUEST,
      text: 'A way to assert that no request fired at all during an action.',
      need: 'Verifying that a debounced search does NOT call the API on every keystroke.',
      currentApproach: 'Calling reticle_network before and after and diffing the counts by hand.',
      model: 'claude-opus-4',
    },
    handler: async (deps, args) => {
      const receipt = await submitFeedback(
        {
          source: FeedbackSource.AGENT,
          kind: asString(args['kind']) as FeedbackKind,
          text: asString(args['text']) ?? '',
          ...optionalText(args, 'trace'),
          ...optionalText(args, 'need'),
          ...optionalText(args, 'impact'),
          ...optionalText(args, 'currentApproach'),
          ...optionalText(args, 'model'),
        },
        { session: sessionFacts(deps, asString(args['sessionId'])) },
      );
      return {
        ...receipt,
        note: receipt.sent
          ? 'Filed — thank you. Continue your task; do not retry a failing call just to re-report it.'
          : 'NOT sent (see reason). Tell the human what you found so it is not lost.',
      };
    },
  },
];

/**
 * The human-facing prompt, delivered to the agent so it can relay the ask at the natural moment —
 * right after a verification lands, when the experience is fresh. MCP has no channel from the server
 * to the person, so the agent is the channel.
 *
 * Delivered ONCE per server process. A prompt on every verification would be nagging, and a nagged
 * user opts out of telemetry entirely, which costs us the counters too.
 */
export const FEEDBACK_PROMPT = {
  ask: 'Ask the human, in your own words and only once: how did this verification go, and what would have made Reticle more useful? If they answer, file it with `reticle feedback` (they run it) or relay it yourself.',
  command: 'reticle feedback',
} as const;

/** Tools whose completion means "a verification just happened" — the only moment worth asking at. */
export const VERIFICATION_TOOLS: ReadonlySet<string> = new Set([
  ReticleTool.ASSERT,
  ReticleTool.FLOW_VERIFY,
  ReticleTool.VERIFY_CHANGE,
  ReticleTool.RECONCILE,
]);

/**
 * Verifications between re-offers of the prompt, and how many times we will ever offer it.
 *
 * Strictly-once was the first design and it was too fragile. A daemon lives for days; the prompt
 * lands on the FIRST verification, which is often several hours before the human is in a position to
 * answer, and if the agent does not relay it in that turn it is gone for the rest of the process.
 * The signal quietly went to zero and nothing would have told us.
 *
 * Re-arming after a run of verifications fixes that without becoming nagging, and the hard cap is
 * what keeps it honest: at most three asks per daemon, ever. A tool that pesters gets muted, and a
 * muted tool collects nothing — the same outcome as never asking, reached more annoyingly.
 */
const PROMPT_REARM_AFTER_VERIFICATIONS = 25;
const MAX_PROMPTS_PER_PROCESS = 3;

let promptsDelivered = 0;
let verificationsSincePrompt = 0;

/**
 * The human prompt, when one is due. Resettable for tests.
 *
 * Silent when the channel is off. Asking someone for feedback we have already been told not to
 * collect is worse than not asking: it spends their attention on a message with nowhere to go.
 */
export function takeFeedbackPrompt(toolName: string): typeof FEEDBACK_PROMPT | undefined {
  if (!VERIFICATION_TOOLS.has(toolName)) return undefined;
  if (feedbackDisabled() || !getTelemetry().enabled) return undefined;
  if (promptsDelivered >= MAX_PROMPTS_PER_PROCESS) return undefined;
  // The very first verification asks immediately; later ones only after another run of work, so the
  // ask always arrives attached to something the human just saw happen.
  if (promptsDelivered > 0 && verificationsSincePrompt < PROMPT_REARM_AFTER_VERIFICATIONS) {
    verificationsSincePrompt += 1;
    return undefined;
  }
  promptsDelivered += 1;
  verificationsSincePrompt = 0;
  return FEEDBACK_PROMPT;
}

export function resetFeedbackPrompt(): void {
  promptsDelivered = 0;
  verificationsSincePrompt = 0;
}
