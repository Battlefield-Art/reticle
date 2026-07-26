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

/** Project-root instruction files the agent re-reads every session. */
export const CLAUDE_MD_PATH = 'CLAUDE.md';
export const AGENTS_MD_PATH = 'AGENTS.md';
/** Cursor project rule; the frontmatter `alwaysApply` keeps it in context on every turn. */
export const CURSOR_RULE_PATH = '.cursor/rules/reticle.mdc';

/** Markers delimiting the managed block so a re-run is idempotent and the block stays updatable. */
const RULE_BEGIN =
  '<!-- reticle:begin (managed by `reticle init` — edit outside these markers) -->';
const RULE_END = '<!-- reticle:end -->';

/** The rule body (markdown). States WHEN to verify, HOW, and never-weaken-a-check. */
const RULE_BODY = `## Verifying with Reticle

This app is instrumented by **Reticle** — an in-app verification layer exposed as \`reticle_*\` MCP tools and the \`reticle\` CLI. Verifying is part of "done", not an optional extra.

- **When:** after you build or change any user-facing feature, flow, or UI, verify it with Reticle **before** telling the user it is complete. Reading the code or passing unit tests is not enough — drive the real running app.
- **How:** drive the actual flow (\`reticle_act\` / \`reticle_act_and_wait\`), then read the observable effect (\`reticle_assert\`, \`reticle_snapshot\`, \`reticle_state\`, \`reticle_network\`). Confirm the change produced the effect it was meant to, with no new console errors or failed requests.
- **Covered flows:** run \`reticle gate\` — it reports which recorded flows the changed files affect and whether they still pass.
- **Never weaken a check to make it green.** Downgrading, skipping, or deleting an assertion is a finding, not a fix.
- **If Reticle can't run** (no daemon, or this is not a running web app), say so — do not skip verification silently.`;

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
    return { status: AgentRuleStatus.ALREADY, content: existing };
  }
  const block = markedBlock();
  if (existing === null || existing === undefined || existing.trim().length === 0) {
    return { status: AgentRuleStatus.APPLY, content: block };
  }
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  return { status: AgentRuleStatus.APPLY, content: `${existing}${separator}${block}` };
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
