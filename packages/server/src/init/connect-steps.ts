/**
 * Which `init` steps decide whether the app can dial the daemon.
 *
 * Lifted out of `plan.ts` when that file reached the size backstop. A cohesive unit on its own
 * terms: one question, asked of a step title, with one consequence — a manual step in this set makes
 * `init` exit non-zero instead of reporting a success over an app that can never connect.
 *
 * Matched on TITLES, which is the fragile part and worth stating: renaming a step in
 * `plan-framework.ts` silently drops it out of this set and nothing goes red. `connect-steps.test.ts`
 * pins the membership for exactly that reason.
 */
/**
 * Titles of the steps WITHOUT which no session ever appears.
 *
 * A ⚠ on one of these is not a warning, it is a guaranteed failure: nothing performs the manual step,
 * so the app will not connect and every Reticle tool will answer "no browser session connected".
 * Reported from a field sweep, where the ⚠ count and "did it connect" were treated as independent
 * signals and are not.
 */
const CONNECT_STEP_TITLES: ReadonlySet<string> = new Set([
  'Connect snippet',
  'Connect snippet (CRA)',
  'Connect snippet (Astro)',
  'Connect snippet (Nuxt)',
  'Reticle client hook',
  'Reticle connect module',
  'ReticleDev component',
  // Writing the component and MOUNTING it are two steps, and only the write was here. A root layout
  // whose shape `init` does not recognise leaves the component on disk and never rendered: the SDK
  // is in the project, nothing imports it, and `init` exited 0 over an app that could not connect.
  'Mount ReticleDev',
  // CRA inlines only REACT_APP_*, so the token has to reach the browser through the env file. This
  // step goes manual when no daemon has ever run and there is no token to inline — and without it
  // the bridge refuses the connection, so the app boots, looks correct, and never pairs. It is
  // APPLY in the ordinary case, so naming it here costs a working install nothing.
  'Pairing token',
  'Vite plugin',
]);

/** True when this step is what makes the app dial the daemon. */
export function isConnectStep(title: string): boolean {
  return CONNECT_STEP_TITLES.has(title);
}
