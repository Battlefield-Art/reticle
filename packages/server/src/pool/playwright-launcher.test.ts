/**
 * The pooled launch hands Playwright more than a headless flag.
 *
 * A pooled browser serves several lease contexts while only one page is ever the visible one, so
 * without the anti-throttling switches every other page gets its timers throttled and its rAF
 * suspended, which is exactly the state a lease reports as `throttled: true`. This pins that what
 * reaches `chromium.launch` carries the switches. It proves plumbing, not Chromium's behavior; the
 * behavioral half needs a real browser and lives outside the unit gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const launchCalls: unknown[] = [];

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn((opts: unknown) => {
      launchCalls.push(opts);
      return Promise.resolve({
        isConnected: () => true,
        newContext: () => Promise.reject(new Error('not reached in this test')),
        close: () => Promise.resolve(),
        on: () => {},
      });
    }),
  },
}));

import { playwrightLauncher } from './playwright-launcher.js';

describe('playwrightLauncher', () => {
  beforeEach(() => {
    launchCalls.length = 0;
  });

  it('passes the anti-throttling args to chromium.launch', async () => {
    const launch = playwrightLauncher({ headless: true });
    const browser = await launch();
    expect(browser.isConnected()).toBe(true);
    expect(launchCalls).toHaveLength(1);
    const opts = launchCalls[0] as { headless?: boolean; args?: readonly string[] };
    expect(opts.headless).toBe(true);
    expect(opts.args).toContain('--disable-background-timer-throttling');
    expect(opts.args).toContain('--disable-backgrounding-occluded-windows');
    expect(opts.args).toContain('--disable-renderer-backgrounding');
  });
});
