/**
 * Pick the control to drive for a first-run demonstration.
 *
 * The whole point of the demo is that a user WATCHES their own app being driven and sees a verdict
 * come back. That only works if the control we drive is one they recognise — the submit button on
 * the form in front of them, not the third link in a footer.
 *
 * Kept pure and separate from the driving, because "which control, and is there one at all" is the
 * judgement, and the judgement is what wants testing. Booting a browser does not.
 */

/** One interactive control, as `reticle_snapshot { mode: "interactive" }` renders it. */
export interface Control {
  ref: string;
  role: string;
  name: string;
  /** The snapshot renders `[disabled]` after the ref. A disabled control cannot demonstrate anything. */
  disabled: boolean;
}

/**
 * Roles worth driving, best first.
 *
 * A button is the thing a user thinks of as "the thing that does something". A link usually
 * navigates away, which ends the demo on a different page than the one they were watching, so it
 * ranks below every button. Text inputs are excluded entirely: clicking one proves nothing, and
 * `no-fault` is the correct verdict for it — an honest answer, but a terrible demonstration.
 */
const DRIVABLE = ['button', 'link'] as const;

/**
 * Parse the controls out of whatever `reticle_snapshot` handed back.
 *
 * The tool returns a JSON object whose `tree` is a STRING, so the quotes around every accessible
 * name arrive escaped. Running the pattern over the raw payload matches nothing, and the demo then
 * reports "this app rendered no button or link" about a page with a form on it — measured exactly
 * that way against a real app, while the debug dump showed `button \"Sign in\" (ref=e5)` sitting
 * right there.
 *
 * So unwrap first, and accept the bare tree too: the caller should not have to know which it holds.
 */
export function parseControls(payload: string): Control[] {
  let tree = payload;
  try {
    const parsed: unknown = JSON.parse(payload);
    if ('object' === typeof parsed && null !== parsed) {
      const inner = (parsed as { tree?: unknown }).tree;
      if ('string' === typeof inner) tree = inner;
    }
  } catch {
    // Not JSON — a bare tree, which is the shape the unit tests use and a caller may well pass.
  }
  return parseTree(tree);
}

function parseTree(tree: string): Control[] {
  // The trailing group captures the state suffix the snapshot appends after the ref — `[disabled]`,
  // `[checked]`, `[value="on"]`. It was being discarded, so the demo could not tell a live button
  // from a dead one. Measured on the hard fixture: its first button is `Hold selected [disabled]`,
  // and the demo would have opened a browser, clicked something that cannot respond, and reported a
  // truthful `no-fault` about a control the user never expected to work. That is a correct verdict
  // and a ruinous first impression.
  return [...tree.matchAll(/-\s*(\w+)\s+"([^"]*)"\s*\(ref=(e\d+)\)([^\n]*)/g)].map((m) => ({
    role: m[1] ?? '',
    name: m[2] ?? '',
    ref: m[3] ?? '',
    disabled: (m[4] ?? '').includes('[disabled]'),
  }));
}

/**
 * The control to drive, or undefined when the app offers nothing worth driving.
 *
 * Undefined is a real answer and must stay one. An app whose first screen is a loading spinner or a
 * wall of text has nothing to demonstrate, and saying so is the honest outcome — an onboarding that
 * fakes its own aha is worse than one that admits the app is not ready to be driven yet.
 */
export function pickControl(controls: readonly Control[]): Control | undefined {
  for (const role of DRIVABLE) {
    // First-seen order within a role: the DOM order is the reading order, and the first button on a
    // page is overwhelmingly the one the page is about.
    const found = controls.find((c) => c.role === role && '' !== c.name && !c.disabled);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What to say when there is nothing to drive. Names the cause AND the fix, like every refusal. */
export const NOTHING_TO_DRIVE =
  'This app rendered no button or link Reticle could drive, so there is nothing to demonstrate ' +
  'yet — not a failure, just an empty first screen. Open a page with a control on it and run this ' +
  'again, or drive it yourself with the reticle_* tools.';

/**
 * A Reticle daemon already owns the port, so `demo` cannot open its own.
 *
 * `demo` binds the bridge port because the SDK in the page dials that port and nothing else. A
 * daemon already there is not a failure state — it means the MCP client this user installed is
 * ALREADY running, so the demonstration they came for is one tool call away and does not need this
 * command at all. Binding a different port would produce a browser that never dials home; racing
 * `reticle stop` is the race drive-attach.ts documents as unwinnable.
 */
export function demoDaemonAlreadyRunning(port: number, url: string): string {
  return (
    `Reticle is already running on :${String(port)} — which means the tools are live and you do ` +
    `not need the demo.\n  Ask your agent to drive it: open ${url}, then reticle_snapshot to see ` +
    'the page and reticle_act_and_wait to drive one control and get a verdict.'
  );
}

/** Someone else's process holds the port: neither binding nor attaching can work. */
export function demoForeignHolder(description: string): string {
  return `${description} \`demo\` needs that port, because the SDK in your page dials it.`;
}
