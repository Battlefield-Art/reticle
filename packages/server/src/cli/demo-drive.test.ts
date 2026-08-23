/**
 * The first-run demo has to drive something the user recognises, or admit it cannot.
 *
 * A user watching their own app should see the button they would have clicked. Driving the third
 * link in a footer is technically a verdict and demonstrates nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  parseControls,
  pickControl,
  NOTHING_TO_DRIVE,
  demoDaemonAlreadyRunning,
  demoForeignHolder,
} from './demo-drive.js';

const TREE = [
  '- textbox "Email" (ref=e103) [value="a@b.c"]',
  '- textbox "Password" (ref=e104)',
  '- button "Sign in" (ref=e105)',
].join('\n');

describe('reading the snapshot', () => {
  /**
   * The shape the TOOL actually returns, which the first version of this parser could not read.
   * `tree` is a JSON string, so every accessible name arrives with escaped quotes; the pattern
   * matched nothing and the demo reported an empty page about an app with a visible form.
   */
  it('reads the JSON envelope the tool really returns, not just a bare tree', () => {
    const payload = JSON.stringify({ tree: TREE, nodes: 3, truncated: false });
    const c = parseControls(payload);
    expect(c).toHaveLength(3);
    expect(c[2]).toEqual({ role: 'button', name: 'Sign in', ref: 'e105', disabled: false });
  });

  it('parses role, name and ref out of the tree', () => {
    const c = parseControls(TREE);
    expect(c).toHaveLength(3);
    expect(c[2]).toEqual({ role: 'button', name: 'Sign in', ref: 'e105', disabled: false });
  });

  it('finds nothing in a page with no controls', () => {
    expect(parseControls('- heading "Welcome"\n- paragraph')).toHaveLength(0);
  });
});

describe('picking what to drive', () => {
  it('prefers a button over the inputs around it', () => {
    expect(pickControl(parseControls(TREE))?.ref).toBe('e105');
  });

  /**
   * Clicking a text input settles the page and proves nothing, so it correctly grades `no-fault`.
   * An honest verdict, and a terrible thing to show somebody as their first impression.
   */
  it('never picks a textbox, whose verdict would be no-fault', () => {
    const onlyInputs = parseControls('- textbox "Email" (ref=e1)\n- textbox "Password" (ref=e2)');
    expect(pickControl(onlyInputs)).toBeUndefined();
  });

  it('falls back to a link when there is no button', () => {
    const links = parseControls('- link "Docs" (ref=e7)');
    expect(pickControl(links)?.ref).toBe('e7');
  });

  it('prefers a button even when a link comes first', () => {
    const mixed = parseControls('- link "Docs" (ref=e7)\n- button "Save" (ref=e8)');
    expect(pickControl(mixed)?.ref).toBe('e8');
  });

  it('skips a control with no accessible name, which nobody can recognise', () => {
    expect(pickControl(parseControls('- button "" (ref=e9)'))).toBeUndefined();
  });
});

describe('admitting there is nothing to show', () => {
  /**
   * The constraint that matters most: an onboarding that fakes its aha is worse than one that says
   * the app is not ready. Undefined has to remain a real answer.
   */
  it('returns undefined rather than driving something arbitrary', () => {
    expect(pickControl([])).toBeUndefined();
  });

  it('has a message that names the cause and the fix', () => {
    expect(NOTHING_TO_DRIVE).toMatch(/nothing to demonstrate/i);
    expect(NOTHING_TO_DRIVE).toMatch(/not a failure/i);
    expect(NOTHING_TO_DRIVE).toMatch(/run this again|drive it yourself/i);
  });
});

describe('the port is already taken', () => {
  /**
   * Measured, not imagined: `reticle demo` against a real app died with a raw `node:net`
   * EADDRINUSE stack because a daemon held :4400 — the normal state for anyone whose MCP client
   * has ever started. A stack trace is the worst possible first output of a demonstration.
   */
  it('never lets a raw bind error stand in for an answer', () => {
    for (const line of [
      demoDaemonAlreadyRunning(4400, 'http://localhost:3000'),
      demoForeignHolder('Something else holds :4400.'),
    ]) {
      expect(line).not.toContain('EADDRINUSE');
      expect(line).not.toContain('node:net');
    }
  });

  it('tells a user who already has Reticle running to just use it', () => {
    const line = demoDaemonAlreadyRunning(4400, 'http://localhost:3000');
    expect(line).toContain('4400');
    expect(line).toContain('http://localhost:3000');
    // The way out has to be a tool they can name, not "stop the daemon and race the proxy".
    expect(line).toMatch(/reticle_snapshot/);
    expect(line).toMatch(/reticle_act_and_wait/);
    expect(line).not.toMatch(/reticle stop/);
  });

  it('says why demo cannot simply move to another port', () => {
    expect(demoForeignHolder('Something else holds :4400.')).toMatch(/dials it/);
  });
});

describe('a control that cannot respond', () => {
  /**
   * The real first screen of the hard fixture, verbatim from `reticle_snapshot`. Its first button
   * is disabled; every live one comes after it. Driving the first match would open a browser for
   * the user, click something inert, and report a truthful `no-fault` — an honest verdict about a
   * control they never expected to work, as the first thing they ever see Reticle do.
   */
  const ATLAS_FIRST_SCREEN =
    '- button "Hold selected" (ref=e9) [disabled]\n' +
    '- radio "all" (ref=e10) [checked]\n' +
    '- textbox "ref…" (ref=e16)\n' +
    '- checkbox "select ATL-100000" (ref=e17) [value="on"]\n' +
    '- button "Dispatch" (ref=e18)\n';

  it('reads the state suffix instead of dropping it', () => {
    const controls = parseControls(ATLAS_FIRST_SCREEN);
    expect(controls.find((c) => 'e9' === c.ref)?.disabled).toBe(true);
    expect(controls.find((c) => 'e18' === c.ref)?.disabled).toBe(false);
  });

  it('drives the first control that can actually do something', () => {
    expect(pickControl(parseControls(ATLAS_FIRST_SCREEN))?.ref).toBe('e18');
  });

  it('still admits there is nothing to show when every control is disabled', () => {
    expect(pickControl(parseControls('- button "Save" (ref=e1) [disabled]'))).toBeUndefined();
  });
});
