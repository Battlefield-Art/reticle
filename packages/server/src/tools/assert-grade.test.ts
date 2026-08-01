import { describe, it, expect } from 'vitest';
import { isPresenceOnlyAssertion, assertsDerivedIpcStatus } from './assert-grade.js';
import type { Predicate } from '../events/predicate.js';

describe('isPresenceOnlyAssertion', () => {
  it('flags a bare element predicate', () => {
    expect(isPresenceOnlyAssertion({ kind: 'element', query: { role: 'button' } })).toBe(true);
  });

  it('flags a bare text predicate', () => {
    expect(isPresenceOnlyAssertion({ kind: 'text', contains: 'Saved' })).toBe(true);
  });

  it('does NOT flag a signal consequence', () => {
    expect(isPresenceOnlyAssertion({ kind: 'signal', name: 'order:placed' })).toBe(false);
  });

  it('does NOT flag a net consequence', () => {
    expect(isPresenceOnlyAssertion({ kind: 'net', urlContains: '/api/order', status: 200 })).toBe(
      false,
    );
  });

  it('does NOT flag presence when a consequence is allOf-ed in', () => {
    const p: Predicate = {
      kind: 'allOf',
      predicates: [
        { kind: 'element', query: { text: 'Done' } },
        { kind: 'signal', name: 'order:placed' },
      ],
    };
    expect(isPresenceOnlyAssertion(p)).toBe(false);
  });

  it('flags an allOf of only presence checks', () => {
    const p: Predicate = {
      kind: 'allOf',
      predicates: [
        { kind: 'element', query: { role: 'dialog' } },
        { kind: 'text', contains: 'Welcome' },
      ],
    };
    expect(isPresenceOnlyAssertion(p)).toBe(true);
  });

  it('does NOT flag non-presence predicates (route / settled / console)', () => {
    expect(isPresenceOnlyAssertion({ kind: 'route', pathname: '/success' })).toBe(false);
    expect(isPresenceOnlyAssertion({ kind: 'settled' })).toBe(false);
    expect(isPresenceOnlyAssertion({ kind: 'console', level: 'error', absent: true })).toBe(false);
  });

  it('flags a negated presence check (still presence-shaped)', () => {
    expect(
      isPresenceOnlyAssertion({
        kind: 'not',
        predicate: { kind: 'element', query: { text: 'x' } },
      }),
    ).toBe(true);
  });
});

describe('derived-status advice — steering off a number Reticle invented', () => {
  /**
   * IPC has no status code. Reticle derives 200/500 so the existing filters keep working, but an
   * agent that asserts `status: 500` is asserting on Reticle's own encoding rather than on what the
   * app did — and if that derivation ever changes, the assertion silently stops meaning what it
   * meant. `ok` is the field that describes the app. Nudge, do not break: the assertion still passes.
   */
  it('advises `ok` when a net assertion pins a status on an IPC call', () => {
    expect(assertsDerivedIpcStatus({ kind: 'net', urlContains: 'ipc://save', status: 500 })).toBe(
      true,
    );
  });

  it('says nothing when the assertion already uses ok', () => {
    expect(assertsDerivedIpcStatus({ kind: 'net', urlContains: 'ipc://save', ok: false })).toBe(
      false,
    );
  });

  it('says nothing about a real HTTP status, which the server genuinely sent', () => {
    expect(assertsDerivedIpcStatus({ kind: 'net', urlContains: '/api/save', status: 500 })).toBe(
      false,
    );
  });

  it('reaches into allOf/anyOf, where a weak clause is easiest to miss', () => {
    expect(
      assertsDerivedIpcStatus({
        kind: 'allOf',
        predicates: [
          { kind: 'console', level: 'error', absent: true },
          { kind: 'net', urlContains: 'ipc://save', status: 500 },
        ],
      }),
    ).toBe(true);
  });
});
