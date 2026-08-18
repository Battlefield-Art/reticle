/**
 * Whether `init` has wired THIS directory — the check `doctor` was missing.
 *
 * `doctor` already read `.reticle.json` for the port, so it knew whether the file existed and never
 * said so. In a project where `init` has not run the checklist came out clean: node fine, chromium
 * fine, a daemon that starts on demand, a bridge port. Every line true, and the app carrying no SDK
 * went unremarked — which is exactly the state that produces "the tools are here and nothing ever
 * verifies", and the state `doctor` is run to explain.
 *
 * Registering the MCP server and instrumenting the app are two different halves of the install, and
 * more than one route does the first without the second.
 */

export interface ProjectWiringFacts {
  /** The id from `.reticle.json`, or undefined when there is no config here. */
  projectId: string | undefined;
  /** Has an app for this project ever connected on this port? Durable across daemon restarts. */
  previouslyConnected: boolean;
}

/**
 * One line, in the same shape as the checks beside it.
 *
 * `previouslyConnected` outranks the missing file, and that ordering is the important part: the Vite
 * and Babel plugins instrument an app without writing a config, so a project that has connected here
 * is wired whatever the file says. Sending it to `init` would be the same wrong answer pointing the
 * other way — and `init` is the one action that can overwrite a setup that already works.
 */
export function projectWiringLine(facts: ProjectWiringFacts): string {
  if (facts.projectId !== undefined) {
    return `  project      ✓ wired here (${facts.projectId})`;
  }
  if (facts.previouslyConnected) {
    return '  project      ✓ an app has connected here before, so it is wired (no .reticle.json — a build plugin can wire an app without one)';
  }
  return (
    '  project      ✗ no .reticle.json here and nothing has ever connected — the tools may be ' +
    'registered, but this app is not instrumented. Run `npx @reticlehq/server init` in the app directory'
  );
}
