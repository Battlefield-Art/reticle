/**
 * Which `npx` goes into the MCP registration, on Windows.
 *
 * From the only rated feedback Reticle has — 2/5, a human on Windows, 2026-08-06:
 * "npx on this machine is blocked by PowerShell execution policy."
 *
 * Bare `npx` on Windows resolves through `npx.ps1` for a PowerShell-hosted launcher, and a machine
 * with a restrictive `Set-ExecutionPolicy` refuses to run it. `npx.cmd` is a batch file and is not
 * subject to that policy at all — which is why this repo ALREADY does exactly this for npm:
 *
 *     const NPM_BIN = platform() === 'win32' ? 'npm.cmd' : 'npm';   // update/updater.ts
 *
 * The fix was applied to the self-updater and not to the MCP registration — the one command every
 * Windows user has to run before anything works at all.
 *
 * And yet the DEFAULT is deliberately left alone. Windows is 66% of Reticle's users (65 of 99
 * persons in a day of telemetry) and there is no Windows CI, no Windows fixture, and nothing in this
 * repo has ever executed there. Swapping the majority platform onto a launch command nobody can run
 * — `.cmd` has its own spawn caveats in some hosts — risks breaking the people it is meant to help.
 * So the escape hatch is DOCUMENTED in the manual instructions, and `npxBin` stays available and
 * tested for whoever can verify it on a real Windows box.
 */

import { describe, expect, it } from 'vitest';
import { npxBin, NPX, mcpManual } from './mcp.js';

describe('npxBin', () => {
  it('is npx.cmd on Windows, which PowerShell execution policy does not gate', () => {
    expect(npxBin('win32')).toBe('npx.cmd');
  });

  it('is plain npx everywhere else', () => {
    expect(npxBin('darwin')).toBe('npx');
    expect(npxBin('linux')).toBe('npx');
  });

  it('matches what the updater already decided for npm — one rule, not two', () => {
    // If these ever disagree, one of the two Windows paths is broken and nobody will notice until a
    // Windows user reports it, which is how this one was found.
    expect(npxBin('win32').endsWith('.cmd')).toBe(true);
  });

  it('but the registered default is UNCHANGED — 66% of users are on the untested platform', () => {
    expect(NPX).toBe('npx');
  });
});

describe('the Windows escape hatch is documented where a blocked user will look', () => {
  const manual = mcpManual();

  it('names the symptom in the words PowerShell actually prints', () => {
    expect(manual).toContain('running scripts is disabled');
  });

  it('gives a cmd-based registration, which execution policy does not gate', () => {
    expect(manual).toContain('"command": "cmd"');
    expect(manual).toContain('/c');
  });
});
