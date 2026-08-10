import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReticleEnv } from '@reticlehq/core';
import { readPid, reticleStateHome } from '../daemon/daemon.js';
import { PortPresence, probePresence, describePresence } from '../daemon/port-presence.js';
import { probeDaemon } from '../mcp/mcp-proxy.js';
import { fetchStatus } from './cli-launch.js';
import { diagnoseDesktop, isDesktopProject } from '../init/desktop-doctor.js';

/**
 * `reticle doctor` — collapse the ~6 independent first-run failure modes into one command. Checks the
 * Chromium install (the #1 silent failure), whether a daemon is up on the resolved bridge port, and
 * reminds the user which port the app must dial. Human-readable to stdout (not the JSON log).
 */
export async function handleDoctor(port: number): Promise<void> {
  const line = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };
  line('reticle doctor');
  line(`  node         ${process.version}`);
  try {
    const { chromium } = await import('playwright');
    const path = chromium.executablePath();
    line(
      existsSync(path)
        ? '  chromium     ✓ installed'
        : '  chromium     ✗ missing — run: npx playwright install chromium',
    );
  } catch {
    line('  chromium     ✗ missing — run: npx playwright install chromium');
  }
  // Ask the PORT, not just the pid file. "not running on :4400" has been printed about a port that
  // was demonstrably occupied, which sends the reader to start a daemon that cannot bind. The three
  // states are genuinely different problems with different fixes, so doctor names which one it is.
  const pid = readPid(port);
  const presence = await probePresence(port, { tcpOpen: probeDaemon, status: fetchStatus });
  if (presence === PortPresence.DAEMON) {
    line(`  daemon       ✓ running on :${port}${null === pid ? '' : ` (pid ${pid})`}`);
  } else if (presence === PortPresence.FOREIGN) {
    line(`  daemon       ✗ ${describePresence(presence, port)}`);
  } else {
    line(
      `  daemon       ✗ not running on :${port} — your agent runs \`reticle mcp\` (or \`reticle serve\`)`,
    );
  }
  line(`  bridge port  ${port}  (your app must dial THIS port — not your dev-server port)`);
  // Where to LOOK when something is wrong. The daemon has always written a structured log here and
  // nothing ever said so, so the first move in every investigation was reading source instead of
  // reading the log. `RETICLE_TRACE=1` turns the same stream into a per-stage trace — see
  // docs/debugging.md.
  line(`  daemon log   ${join(reticleStateHome(), `daemon-${String(port)}.log`)}`);
  line(`  tracing      ${ReticleEnv.TRACE}=1 on the daemon for per-stage timings in that log`);

  // Desktop setup RCA. Every one of these fails SILENTLY — a Tauri app with the default CSP runs
  // perfectly and never connects; an Electron app without the preload line reports zero network
  // activity forever, which reads as "makes no backend calls" rather than "you are blind to them".
  const readProjectFile = (relative: string): string | undefined => {
    try {
      return readFileSync(join(process.cwd(), relative), 'utf8');
    } catch {
      return undefined;
    }
  };
  const desktop = diagnoseDesktop(readProjectFile, port);
  if (desktop.length > 0) {
    line('');
    line(
      `  desktop      ✗ ${String(desktop.length)} issue(s) — the app will look fine and not work:`,
    );
    for (const finding of desktop) {
      line(`                 ${finding.file}`);
      line(`                   ${finding.problem}`);
      line(`                   fix: ${finding.fix}`);
    }
  } else if (isDesktopProject(readProjectFile)) {
    // Say so explicitly. Silence would read as "not checked", which is the same ambiguity the
    // findings above exist to remove.
    line('  desktop      ✓ desktop wiring looks right');
  }
}
