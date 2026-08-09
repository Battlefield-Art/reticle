/**
 * `ok: true` from a navigation that may never have arrived.
 *
 * The browser's NAVIGATE command is `window.location.assign(url); return { ok: true, url }` —
 * returned SYNCHRONOUSLY, before the page goes anywhere. It cannot be otherwise: by the time the new
 * document exists, the SDK that would report on it has been torn down with the old one.
 *
 * So `ok` means "the navigation was dispatched", and the tool presented it as though it meant
 * "arrived". Driven live against a dead URL, `reticle_navigate` returned `{"ok":true}` — and the
 * browser session DIED, because the tab left the instrumented app. The agent is told the navigation
 * succeeded, is now looking at nothing, and has lost Reticle entirely.
 *
 * This repo already has the vocabulary for exactly this distinction: `reticle_act` separates
 * `dispatched` (the event was sent) from `settled` (a real frame flushed). Navigate collapsed both
 * into one optimistic word.
 *
 * The FIX here is the envelope, not the behaviour: `ok` keeps its meaning for existing callers, and
 * the result now says plainly that arrival is unconfirmed and how to confirm it. Making navigate
 * actually wait for the new session is a behaviour change with timing consequences, and is recorded
 * as a decision rather than taken.
 */

import { describe, expect, it } from 'vitest';
import { navigateResult } from './navigate-result.js';

describe('navigateResult', () => {
  it('keeps ok for existing callers', () => {
    expect(navigateResult({ ok: true, url: 'http://localhost:3000/x' })).toMatchObject({
      ok: true,
      url: 'http://localhost:3000/x',
    });
  });

  it('says arrival is UNCONFIRMED, because the SDK cannot survive the navigation to report it', () => {
    const out = navigateResult({ ok: true, url: 'http://x/y' });
    expect(out['confirmed']).toBe(false);
    expect(String(out['note'])).toMatch(/dispatch/i);
    // And names the way to actually check.
    expect(String(out['note'])).toContain('reticle_sessions');
  });

  it('does not claim dispatch when the browser refused outright', () => {
    // A refusal IS conclusive — the page never moved, so there is nothing unconfirmed about it.
    const out = navigateResult({ ok: false, reason: 'only http(s) navigation is allowed' });
    expect(out).toMatchObject({ ok: false, reason: 'only http(s) navigation is allowed' });
    expect(out['confirmed']).toBeUndefined();
    expect(out['note']).toBeUndefined();
  });

  it('passes a reason through when one is given', () => {
    expect(navigateResult({ ok: false, reason: 'url required' })['reason']).toBe('url required');
  });
});
