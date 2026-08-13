/**
 * The Chromium hint must be satisfiable by following it, and arguable when it is wrong.
 *
 * The reported failure was a loop: doctor says missing, the user runs the suggested command, the
 * command succeeds, doctor still says missing. That is what an unpinned `npx playwright install`
 * does when the daemon bundles a different playwright — a different browser revision lands, and the
 * check the user was trying to satisfy never looked at it.
 */

import { describe, expect, it } from 'vitest';
import { chromiumHint, chromiumInstallCommand } from './chromium-hint.js';

describe('chromium install command', () => {
  it('pins to the playwright the daemon actually bundles', () => {
    expect(chromiumInstallCommand('1.61.1')).toBe('npx playwright@1.61.1 install chromium');
  });

  it('falls back to an unpinned command rather than none', () => {
    expect(chromiumInstallCommand(undefined)).toBe('npx playwright install chromium');
  });
});

describe('chromium doctor line', () => {
  it('says installed without further advice when it is', () => {
    expect(chromiumHint({ exists: true })).toBe('✓ installed');
  });

  it('names the path it probed, so a wrong lookup is visible', () => {
    const line = chromiumHint({
      exists: false,
      executablePath: '/Users/x/ms-playwright/chromium-1228/chrome',
      playwrightVersion: '1.61.1',
    });
    expect(line).toContain('/Users/x/ms-playwright/chromium-1228/chrome');
    expect(line).toContain('npx playwright@1.61.1 install chromium');
  });

  it('distinguishes a missing browser from a missing playwright', () => {
    expect(chromiumHint({ exists: false })).toContain('playwright package is not installed');
  });
});
