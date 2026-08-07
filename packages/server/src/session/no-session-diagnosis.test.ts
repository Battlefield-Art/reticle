/**
 * The message that ends most sessions.
 *
 * Measured over yesterday's telemetry: of the 25 sessions that called any tool, 13 made exactly ONE
 * call and stopped — 8 of them `reticle_sessions` — and 10 of those 13 never touched a browser.
 * Every recorded session error is the same one:
 *
 *   "no browser session connected. Two things to check: (1) your app is running with
 *    @reticlehq/browser enabled, and (2) it points at THIS daemon's port"
 *
 * It is accurate and it is fatal. It names two things the agent cannot check from where it stands
 * and gives it nothing to DO, so the agent abandons the tool for the rest of the session. 74% of
 * sessions never call a tool at all, and this is what greets most of the ones that try.
 *
 * The daemon can tell these three cases apart, and they have completely different next actions:
 *   - nothing is listening anywhere       -> the dev server is not running; start it
 *   - something is listening, never dialled -> the SDK is not wired into that app; run `reticle init`
 *   - a session was connected and went away -> the tab closed or reloaded; reopen/reload it
 *
 * Today all three produce the same dead end.
 */

import { describe, expect, it } from 'vitest';
import { diagnoseNoSession } from './no-session-diagnosis.js';

describe('diagnoseNoSession', () => {
  it('a session was here and left — say so, and say what to do', () => {
    const msg = diagnoseNoSession({ everConnected: true, initialized: true, listening: [], port: 4400 });
    expect(msg).toMatch(/was connected|disconnected|reload/i);
    // Never send someone to check the install when the install demonstrably worked.
    expect(msg).not.toMatch(/reticle init/);
  });

  it('a dev server is up but never dialled — name the port, and point at the wiring', () => {
    const msg = diagnoseNoSession({
      everConnected: false,
      initialized: false,
      listening: [5173],
      port: 4400,
    });
    expect(msg).toContain('5173');
    expect(msg).toContain('reticle init');
    // The actionable half: the app is RUNNING, so "is your app running?" is the wrong question.
    expect(msg).toMatch(/not wired|never connected|no Reticle SDK/i);
  });

  it('a dev server is up and the project IS wired — then it is the port or a stale build', () => {
    const msg = diagnoseNoSession({
      everConnected: false,
      initialized: true,
      listening: [3000],
      port: 4400,
    });
    expect(msg).toContain('3000');
    expect(msg).toContain('4400');
    expect(msg).toMatch(/restart|reload|port/i);
    expect(msg).not.toMatch(/reticle init/);
  });

  it('nothing is listening at all — the app is simply not running', () => {
    const msg = diagnoseNoSession({ everConnected: false, initialized: true, listening: [], port: 4400 });
    expect(msg).toMatch(/no dev server|not running/i);
    // Do not ask the agent to check the SDK when there is no app to have an SDK in.
    expect(msg).not.toMatch(/reticle init/);
  });

  it('names every listening candidate, not just the first', () => {
    const msg = diagnoseNoSession({
      everConnected: false,
      initialized: true,
      listening: [3000, 5173],
      port: 4400,
    });
    expect(msg).toContain('3000');
    expect(msg).toContain('5173');
  });

  it('always ends with something the agent can DO', () => {
    for (const input of [
      { everConnected: true, initialized: true, listening: [], port: 4400 },
      { everConnected: false, initialized: false, listening: [5173], port: 4400 },
      { everConnected: false, initialized: true, listening: [], port: 4400 },
    ]) {
      const msg = diagnoseNoSession(input);
      expect(msg.length, JSON.stringify(input)).toBeGreaterThan(40);
      // An imperative, not a description of the world.
      expect(msg, JSON.stringify(input)).toMatch(/start |run |reload|reopen|restart|check /i);
    }
  });
});
