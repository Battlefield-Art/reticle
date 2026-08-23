/**
 * `reticle demo <url>` — the first thing a new user should ever see Reticle do.
 *
 * The install ends with files written and an instruction. Nothing shows the user what they just
 * installed, and the one path that could — the MCP tools — is unreachable until they restart their
 * client, which is precisely where the funnel breaks.
 *
 * This sidesteps that entirely. `reticle verify` already proves the hard part is solved: it boots
 * its OWN daemon and its OWN browser and needs no MCP client at all. What it cannot do is help a
 * fresh project, because it replays saved flows and a new project has none.
 *
 * So this assembles the same machinery for an app with nothing recorded yet: open a HEADFUL browser
 * the user can watch, read the page, drive one control they would recognise, and print the verdict
 * with the file and line behind it. No MCP, no restart, no saved flows, no human.
 *
 * Two honesty rules, neither negotiable:
 *   - It may fail. An app with nothing drivable is told so plainly. An onboarding that fakes its
 *     own aha is worse than one that admits the app is not ready.
 *   - The verdict is real. A click that proves nothing grades `no-fault`, exactly as everywhere
 *     else. Watching Reticle be honest IS the demonstration.
 */

import { ReticleEnv, RETICLE_DEFAULT_PORT } from '@reticlehq/core';
import { start } from '../index.js';
import { TOOLS } from '../tools/tools.js';
import { runTool } from '../tools/invoke-tool.js';
import { ReticleTool } from '../tools/tool-names.js';
import { parseControls, pickControl, NOTHING_TO_DRIVE } from './demo-drive.js';
import { createNodeFileSystem } from '../project/fs-port.js';
import { BaselineStore } from '../project/baselines.js';
import { RecordingStore } from '../flows/recordings.js';
import { FlowStore } from '../flows/flows.js';
import { AnnotationStore } from '../flows/annotation-store.js';
import { ProjectStore } from '../project/project-store.js';
import type { ToolDeps } from '../tools/tools.js';

/** How long the app gets to load and dial the daemon before we give up on it. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Attempts to read a painted page before believing it is empty, and the gap between them. */
const FIRST_PAINT_ATTEMPTS = 12;
const FIRST_PAINT_STEP_MS = 400;
/** How long the driven control gets to cause something. */
const SETTLE_MS = 8_000;

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (t === undefined) throw new Error(`demo needs ${name}, which is not registered`);
  return t;
};

const text = (r: unknown): string => {
  const rec = r as { content?: { text?: string }[] } | undefined;
  return rec?.content?.[0]?.text ?? JSON.stringify(r);
};

export interface DemoPorts {
  print: (line: string) => void;
  fail: (line: string) => void;
}

/**
 * Drive one control and report.
 *
 * Split from the boot so the reporting can be read on its own: this is the part a user sees, and
 * every branch of it has to be true.
 */
export async function runDemo(deps: ToolDeps, ports: DemoPorts): Promise<boolean> {
  // Retry the read rather than sleep a fixed amount.
  //
  // The session registers when the SDK dials, which is BEFORE the framework has painted anything.
  // Measured on a real app: the first snapshot came back with zero controls on a page that clearly
  // has a form, and the demo reported "nothing to demonstrate" about an app that was simply still
  // rendering. A fixed sleep would trade that for being slow on every app instead of wrong on some.
  let controls: ReturnType<typeof parseControls> = [];
  for (let attempt = 0; attempt < FIRST_PAINT_ATTEMPTS && 0 === controls.length; attempt++) {
    if (0 !== attempt) await new Promise((r) => setTimeout(r, FIRST_PAINT_STEP_MS));
    const snap = await runTool(tool(ReticleTool.SNAPSHOT), deps, { mode: 'interactive' });
    controls = parseControls(text(snap));
  }
  const target = pickControl(controls);
  if (target === undefined) {
    ports.print(NOTHING_TO_DRIVE);
    return false;
  }

  ports.print(`  Driving "${target.name}" and looking for problems — watch the browser.`);

  // No `until`, deliberately.
  //
  // The first instinct was to declare a consequence so the demo could show a green. There is none
  // to declare: no consequence is true of an app nobody has read. Inventing one would either be
  // trivially satisfiable — a green nobody earned — or fail on a healthy app and accuse it of a
  // defect. Naming the consequence is the agent's job precisely because it requires knowing the app.
  const result = (await runTool(tool(ReticleTool.ACT_AND_WAIT), deps, {
    ref: target.ref,
    action: 'click',
    timeout_ms: SETTLE_MS,
  })) as Record<string, unknown>;

  const rawVerified = result['verified'];
  const verified = 'string' === typeof rawVerified ? rawVerified : 'unknown';
  const effect = result['effect'] as { source?: { file?: string; line?: number } } | undefined;
  const src = effect?.source;
  const where = src?.file === undefined ? '' : `  ${src.file}:${String(src.line ?? 0)}`;
  const inner = (effect as { effect?: Record<string, unknown> } | undefined)?.effect;
  const mutated = inner?.['domMutatedWithin'];

  ports.print('');
  if ('number' === typeof mutated)
    ports.print(`  the DOM changed ${String(mutated)}ms after the click${where}`);

  // THE POINT OF THE DEMO: what is wrong with this app.
  //
  // A verdict on one click is a capability demonstration. A finding is a REASON — the moment
  // somebody understands why they would keep this installed. So the demo goes looking: the crawl
  // drives every reachable control and reports single-channel faults and contradictions, and the
  // console read catches what the DOM never shows.
  const crawl = (await runTool(tool(ReticleTool.VERIFY), deps, {
    action: 'crawl',
  })) as Record<string, unknown>;
  const anomalies = Array.isArray(crawl['anomalies'])
    ? (crawl['anomalies'] as { kind?: unknown; desc?: unknown }[])
    : [];
  const consoleRead = (await runTool(tool(ReticleTool.CONSOLE), deps, {
    level: 'error',
  })) as Record<string, unknown>;
  const errors = Array.isArray(consoleRead['entries']) ? consoleRead['entries'].length : 0;

  const found = anomalies.length + errors;
  ports.print('');
  if (0 === found) {
    // An honest nothing. Saying "no problems" about an app we barely touched would be the same
    // false confidence the verdicts refuse to give.
    ports.print(
      `  Nothing wrong in what it touched — ${String(controls.length)} control(s) seen, one driven, console clean.`,
    );
    ports.print(
      '  That is a narrow check, not a clean bill of health. Drive a real flow for that.',
    );
  } else {
    ports.print(`  Found ${String(found)} thing(s) worth looking at:`);
    for (const a of anomalies.slice(0, 5)) {
      const kind = 'string' === typeof a.kind ? a.kind : 'anomaly';
      const desc = 'string' === typeof a.desc ? a.desc : '';
      ports.print(`    · ${kind}${'' === desc ? '' : ` — ${desc}`}`);
    }
    if (0 !== errors) ports.print(`    · ${String(errors)} console error(s) your DOM never showed`);
  }

  ports.print('');
  ports.print(
    `  verdict on the click: ${verified}. That is Reticle: it drove your app from the inside, ` +
      'and told you what it could and could not prove.',
  );
  return true;
}

/** Boot a headful browser at the app and drive it. */
export async function handleDemo(url: string, port: number | undefined): Promise<void> {
  const ports: DemoPorts = {
    print: (l) => process.stdout.write(`${l}\n`),
    fail: (l) => process.stderr.write(`${l}\n`),
  };
  const envPort = Number(process.env[ReticleEnv.PORT]);
  const resolved =
    Number.isFinite(envPort) && envPort > 0 ? envPort : (port ?? RETICLE_DEFAULT_PORT);
  const fs = createNodeFileSystem();
  const reticleRoot = `${process.cwd()}/.reticle`;

  ports.print(`  Opening ${url} …`);
  const running = await start({
    port: resolved,
    driveUrl: url,
    // The entire point: the user watches this happen.
    headless: false,
    mcp: false,
    reticleRoot,
  });
  const deps: ToolDeps = {
    sessions: running.bridge.sessions,
    baselines: new BaselineStore(),
    recordings: new RecordingStore(),
    flows: new FlowStore(fs, reticleRoot, { now: () => Date.now() }),
    annotations: new AnnotationStore(),
    project: new ProjectStore(fs, reticleRoot, { now: () => Date.now() }),
    fs,
    reticleRoot,
    now: () => Date.now(),
  };

  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  while (0 === deps.sessions.list().length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (0 === deps.sessions.list().length) {
    // Never blame the app for something we cannot see. This is the same split `status` makes.
    ports.fail(
      `  The page at ${url} loaded but never dialled Reticle, so there is nothing to drive.\n` +
        '  That is the SDK not reaching the running page — run `npx @reticlehq/server doctor` for which half is missing.',
    );
    process.exitCode = 1;
    await running.close();
    return;
  }

  try {
    await runDemo(deps, ports);
  } finally {
    await running.close();
  }
}
