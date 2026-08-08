/**
 * `reticle init` writes a behavioral rule into the coding agent's instruction file so the agent
 * VERIFIES a feature with Reticle after building it — not only when the user remembers to say "test
 * it with reticle". Registering the MCP server (mcp.ts / cursor.ts) only makes the tools AVAILABLE;
 * this is the piece that makes the agent reach for them, every session, unprompted.
 *
 * The rule is framed as a definition-of-done (WHEN to verify, HOW, and the anti-reward-hacking guard),
 * written into whichever instruction file the detected agent reads: `CLAUDE.md` (Claude Code),
 * `.cursor/rules/reticle.mdc` (Cursor, `alwaysApply` so it stays in context), or `AGENTS.md` as the
 * cross-agent fallback. Idempotent via a marker block — safe to append to an existing file and a
 * re-run is a no-op. Mirrors the apply/already result shape used across init (see cursor.ts).
 */

import { NPX } from './mcp.js';
import { RETICLE_NPM_PACKAGE } from '../server-version.js';

/** Project-root instruction files the agent re-reads every session. */
export const CLAUDE_MD_PATH = 'CLAUDE.md';
export const AGENTS_MD_PATH = 'AGENTS.md';
/** Cursor project rule; the frontmatter `alwaysApply` keeps it in context on every turn. */
export const CURSOR_RULE_PATH = '.cursor/rules/reticle.mdc';

/** Markers delimiting the managed block so a re-run is idempotent and the block stays updatable. */
const RULE_BEGIN =
  '<!-- reticle:begin (managed by `reticle init` — edit outside these markers) -->';
const RULE_END = '<!-- reticle:end -->';

/**
 * How the agent must INVOKE the CLI.
 *
 * `reticle init` installs the SDK packages, never the server — so there is no `reticle` on the
 * agent's PATH, and every bare `reticle <cmd>` this rule named was an instruction that could not be
 * followed. Reported from a field sweep: three of them, in the file the agent re-reads every session.
 *
 * `npx @reticlehq/server` is the same invocation the MCP registration uses, and it is derived from
 * the package's own name so the two can never drift apart.
 */
const CLI = `${NPX} ${RETICLE_NPM_PACKAGE}`;

/** The rule body (markdown). States WHEN to verify, HOW, and never-weaken-a-check. */
const RULE_BODY = `## Verifying with Reticle

This app is instrumented by **Reticle** — an in-app verification layer exposed as \`reticle_*\` MCP tools and the \`${CLI}\` CLI (run it through npx — Reticle's server is not installed into this project). Verifying is part of "done", not an optional extra.

- **When:** after you build or change any user-facing feature, flow, or UI, verify it with Reticle **before** telling the user it is complete. Reading the code or passing unit tests is not enough — drive the real running app.
- **How:** drive the actual flow (\`reticle_act\` / \`reticle_act_and_wait\`), then read the observable effect (\`reticle_assert\`, \`reticle_snapshot\`, \`reticle_state\`, \`reticle_network\`). Confirm the change produced the effect it was meant to, with no new console errors or failed requests.
- **Covered flows:** run \`${CLI} gate\` — it reports which recorded flows the changed files affect and whether they still pass.
- **Never weaken a check to make it green.** Downgrading, skipping, or deleting an assertion is a finding, not a fix.
- **If Reticle can't run** (no daemon, or this is not a running web app), say so — do not skip verification silently.
- **If a tool result carries \`version_skew\`, act on it before trusting anything else.** Two pieces of Reticle are on different wire contracts, so tools can misbehave in ways neither side reports — a green here is not evidence. The field says which pair disagrees and names the exact fix: run \`${CLI} stop\` and retry when the DAEMON is stale, or tell the human to install the matching SDK and restart their dev server when the PAGE is. Do that first, then redo whatever you were verifying.
- **If a tool result carries \`update_available\`, say so.** Reticle checked npm and a newer version exists. Tell the human the version numbers and offer to run \`${CLI} update\` — between tasks, never mid-verification, because it restarts the daemon and drops the session. Finish what you are doing first.
- **Wish Reticle could do something? Ask for it with \`reticle_feedback\`.** Reticle is built for agents, so what you find awkward or missing is what decides the roadmap — and you are the only one who can report it, because that thought disappears when your context does. Put the report itself in \`text\` (the only required field) and pick a \`kind\`: \`feature_request\` for something that does not exist, \`improvement\` for something that works but costs too many calls, \`bug\` for a tool that returned something wrong, \`gap\` for something Reticle could not observe at all, \`ambiguity\` for a verdict you could not act on. Say what you are actually trying to achieve (\`need\`) and how you work around it today (\`currentApproach\`), and set \`model\` to the model you are running. File it the moment you notice, then carry on — nothing is too minor.
- **If Reticle itself fails you, tell its maintainers with \`reticle_feedback\`.** A tool that returned something wrong, a thing Reticle could not observe at all, or a verdict you could not act on — file it as \`text\` — a root-cause analysis with the call trace — under \`kind: bug\` (wrong result), \`gap\` (could not observe it) or \`ambiguity\` (undecidable verdict), then carry on with the task. Working around a broken tool in silence is how the same defect survives. This is about defects in *Reticle*; a bug you find in *this app* is Reticle working, and belongs in your report to the user instead.`;

export const AgentRuleStatus = {
  APPLY: 'apply',
  ALREADY: 'already',
} as const;
export type AgentRuleStatus = (typeof AgentRuleStatus)[keyof typeof AgentRuleStatus];

export interface AgentRuleResult {
  status: AgentRuleStatus;
  /** Full file content to write when status is APPLY; the unchanged input otherwise. */
  content: string;
}

/** The marker-wrapped block appended to a CLAUDE.md / AGENTS.md instruction file. */
export function markedBlock(): string {
  return `${RULE_BEGIN}\n${RULE_BODY}\n${RULE_END}\n`;
}

/**
 * Merge the managed block into a marker-delimited instruction file. Already present ⇒ no change
 * (idempotent re-run). Absent/empty ⇒ the block alone. Otherwise append the block, preserving the
 * existing content and a clean separating blank line.
 */
export function mergeMarkedInstruction(existing: string | null | undefined): AgentRuleResult {
  if (existing !== null && existing !== undefined && existing.includes(RULE_BEGIN)) {
    // A block that can never be updated is not managed. Returning ALREADY on sight of the marker
    // meant a project that ran init once kept that release's rule text forever, so every improvement
    // reached only new projects — and a rule about a field introduced later (`version_skew`) could
    // never arrive at all. The markers promise the inside is ours; idempotence comes from comparing
    // CONTENT instead of presence.
    return refreshMarkedBlock(existing);
  }
  const block = markedBlock();
  if (existing === null || existing === undefined || existing.trim().length === 0) {
    return { status: AgentRuleStatus.APPLY, content: block };
  }
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  return { status: AgentRuleStatus.APPLY, content: `${existing}${separator}${block}` };
}

/**
 * Swap the managed block for the current one, leaving every character outside the markers alone.
 *
 * A malformed file — a begin marker with no end — is left untouched and reported ALREADY. Rewriting
 * from a marker to end-of-file would eat whatever the human wrote after it, and silently destroying
 * someone's instruction file is far worse than a stale rule.
 */
function refreshMarkedBlock(existing: string): AgentRuleResult {
  const start = existing.indexOf(RULE_BEGIN);
  const endAt = existing.indexOf(RULE_END, start);
  if (endAt === -1) return { status: AgentRuleStatus.ALREADY, content: existing };
  const current = existing.slice(start, endAt + RULE_END.length);
  const wanted = markedBlock().trimEnd();
  if (current === wanted) return { status: AgentRuleStatus.ALREADY, content: existing };
  const content = `${existing.slice(0, start)}${wanted}${existing.slice(endAt + RULE_END.length)}`;
  return { status: AgentRuleStatus.APPLY, content };
}

/** The Cursor rule file (.mdc): `alwaysApply` keeps the rule in every turn's context. */
export function cursorRuleFile(): string {
  return `---
description: Verify web features with Reticle after building them
alwaysApply: true
---

${RULE_BODY}
`;
}
