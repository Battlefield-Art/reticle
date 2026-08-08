/**
 * The `/reticle` slash command — the entry point the docs have been promising and nothing created.
 *
 * SKILL.md tells the user "Type `/reticle` anytime to verify the app" in three places, and `init`
 * never wrote the file that makes it exist. So the one obvious way in was a command that silently did
 * nothing in every tool. Claude Code and Cursor both read custom commands from a markdown file per
 * command; the body is the prompt the agent receives.
 *
 * Deliberately SCOPED to one flow. A user installing Reticle has an existing app with many flows, and
 * an agent told to "verify the app" will try to instrument all of them — slow, noisy, and nothing to
 * see for minutes. One flow, driven where the human can watch it, is the whole difference between a
 * two-minute first impression and an afternoon.
 */

/** Claude Code reads project commands from `.claude/commands/<name>.md`. */
export const CLAUDE_COMMAND_PATH = '.claude/commands/reticle.md';
/** Cursor reads them from `.cursor/commands/<name>.md`. */
export const CURSOR_COMMAND_PATH = '.cursor/commands/reticle.md';

/**
 * The frontmatter line that marks a command file as OURS.
 *
 * A stale command has to be refreshable — a file frozen at whatever release created it can never be
 * improved for anyone who already ran init — but the path is one a human may have claimed for their
 * own `/reticle`, and overwriting that would be destroying somebody's work. This line is how the two
 * are told apart.
 */
export const SLASH_COMMAND_SIGNATURE =
  'description: Verify this app in the browser with Reticle';

export const SLASH_COMMAND_BODY = `---
${SLASH_COMMAND_SIGNATURE} — drive one real flow and report what happened.
---

Verify this running app with Reticle. Drive it; do not read the code and guess.

## Pick ONE flow

Not the whole app. Pick the single most important flow you can complete in a handful of steps — the
one a user would do first (sign in, search, add to cart, submit the form). If the user named a flow or
just changed some code, use that one instead.

State which flow you picked in one line before you start.

## Drive it where the human can see

1. \`reticle_sessions\` — find the connected tab. None? Tell the user to run their dev server and open
   the app, then stop. Reticle never starts a dev server.
2. \`reticle_snapshot\` — read the accessibility tree and locate the elements the flow needs. Elements
   are addressable by role and name; you do **not** need \`data-testid\` to drive them.
3. Walk the flow with \`reticle_act_and_wait\`, one step at a time. Narrate each step first — the human
   is watching the page, and the HUD shows what you say.
4. After each step, check the effect with \`reticle_assert\` — not just that the click dispatched, but
   that the thing it was supposed to do actually happened.
5. Finish with \`reticle_console\` and \`reticle_network\` to catch errors the DOM does not show.

## Report

- What you drove, step by step, and what each step actually produced.
- Anything broken, with the \`file:line\` Reticle gave you.
- If a step could not be verified, say so plainly. "Unknown" is a real answer; a green verdict you
  cannot back is not.

Do not weaken or skip an assertion to make the run pass — that is a finding, not a fix.
`;
