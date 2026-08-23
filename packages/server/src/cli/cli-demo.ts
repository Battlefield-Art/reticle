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

  ports.print(`  Driving "${target.name}" — watch the browser.`);
  // No `until`, deliberately.
  //
  // The first instinct here was to declare a consequence so the demo could show a green. There is
  // none to declare: no consequence is true of an app nobody has read. Inventing one would either
  // be trivially satisfiable — a green nobody earned — or fail on a healthy app and accuse it of a
  // defect. Naming the consequence is the agent's job precisely because it needs to know the app.
  //
  // So the click is honest and the verdict is `no-fault`, and the report leads with what Reticle
  // OBSERVED instead. That is the better demonstration anyway: it shows the machinery seeing the
  // app from the inside, and then declining to call it verified. The declining is the product.
  // Through `runTool`, not `.handler` directly. That is the one chokepoint where a call is counted
  // and a result is enveloped; a demo that sidestepped it would be invisible to every measurement
  // this project makes about which tools get used — and the demo is about to become the most-run
  // path in the product.
  const result = (await runTool(tool(ReticleTool.ACT_AND_WAIT), deps, {
    ref: target.ref,
    action: 'click',
    timeout_ms: SETTLE_MS,
  })) as Record<string, unknown>;

  // Narrowed rather than String()-ed. These come off an `unknown` record, and stringifying an
  // object there yields "[object Object]" — which would print as a verdict and read like one.
  // The whole demo is a claim about honesty; it must not be the thing that prints a fake value.
  const rawVerified = result['verified'];
  const rawBecause = result['because'];
  const verified = 'string' === typeof rawVerified ? rawVerified : 'unknown';
  const because = 'string' === typeof rawBecause ? rawBecause : '';
  const effect = result['effect'] as { source?: { file?: string; line?: number } } | undefined;
  const src = effect?.source;
  const where = src?.file === undefined ? '' : `  ${src.file}:${String(src.line ?? 0)}`;

  // What it SAW, before what it concluded. A user watching their own app wants the observation
  // first: it is the part that is impressive and the part a screenshot could never produce.
  const inner = (effect as { effect?: Record<string, unknown> } | undefined)?.effect;
  const mutated = inner?.['domMutatedWithin'];
  const appeared = inner?.['appeared'];
  ports.print('');
  if ('number' === typeof mutated)
    ports.print(`  the DOM changed ${String(mutated)}ms after the click`);
  if ('string' === typeof appeared && '' !== appeared)
    ports.print(`  what appeared: ${appeared.slice(0, 120)}`);
  ports.print(`  verified: ${verified}${where}`);
  if ('' !== because) ports.print(`  ${because}`);
  ports.print('');
  // Deliberately says what it did NOT prove. A click with nothing declared grades `no-fault`, and
  // presenting that as a success would be the exact false green this product exists to prevent.
  ports.print(
    'no-fault' === verified
      ? '  That is Reticle being honest: the click landed, nothing was declared to prove, so nothing was proved. Name a consequence with `until` and it becomes a real verdict.'
      : '  That is Reticle: it drove your app and reported what happened, from the inside.',
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
