// Headed runner: launches a MAXIMIZED real-input browser at the demo (presenter HUD on),
// runs the declarative specs, prints pass/fail with evidence.
//
// Why this isn't just bootSession(): bootSession launches Playwright with its default
// 1280x720 viewport, so the OS "maximize" grows the window chrome but not the page — it
// looks letterboxed. Here we inject a launcher with --start-maximized + viewport:null so
// the page fills the whole window. Set IRIS_DEMO_PACE_MS to slow each step for recording.
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  start,
  createToolInvoker,
  LaunchedRealInputProvider,
  BaselineStore,
  RecordingStore,
  FlowStore,
  ProjectStore,
  AnnotationStore,
  createNodeFileSystem,
} from '../../../packages/server/dist/index.js';
import { runSpecs, createTestContext } from '../../../packages/test/dist/index.js';
import './tour.spec.mjs'; // registers the guided ~1-min tour

const DEMO_URL = 'http://localhost:4313/?present&session=demo';
const BRIDGE_PORT = 4400; // demo SDK is started with IRIS_PORT=4400 → connects here

// A launcher that opens maximized and yields full-window (viewport:null) pages.
const maximizedLaunch = async (headless) => {
  const browser = await chromium.launch({
    headless,
    args: ['--start-maximized', '--window-position=0,0'],
  });
  // The provider calls browser.newPage(); wrap it to use a viewport:null context so the
  // page fills the maximized window instead of Playwright's fixed 1280x720.
  return new Proxy(browser, {
    get(target, prop, recv) {
      if (prop === 'newPage') {
        return async () => {
          const ctx = await target.newContext({ viewport: null });
          return ctx.newPage();
        };
      }
      const value = Reflect.get(target, prop, recv);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

const realInputFactory = ({ driveUrl, headless }) =>
  new LaunchedRealInputProvider({ driveUrl, headless, launch: maximizedLaunch });

const server = await start({
  mcp: false,
  driveUrl: DEMO_URL,
  headless: false,
  port: BRIDGE_PORT,
  realInputFactory,
});

// Build the same ToolDeps bootSession would, over our started server.
const fs = createNodeFileSystem();
const irisRoot = join(process.cwd(), '.iris');
const now = () => Date.now();
const deps = {
  sessions: server.bridge.sessions,
  baselines: new BaselineStore(),
  recordings: new RecordingStore(),
  flows: new FlowStore(fs, irisRoot, { now }),
  project: new ProjectStore(fs, irisRoot, { now }),
  annotations: new AnnotationStore(),
  fs,
  irisRoot,
  now,
  ...(server.realInput !== undefined ? { realInput: server.realInput } : {}),
};
const invoke = createToolInvoker(deps);

// Give the page a moment to load + the SDK to connect to the bridge.
await new Promise((r) => setTimeout(r, 3000));

const { summary } = await runSpecs({
  invoke,
  now,
  buildContext: (inv) => createTestContext(inv, { sessionId: 'demo' }),
  print: (line) => process.stdout.write(line + '\n'),
});

await server.close();
process.stdout.write(`\n=== ${summary.passed} passed · ${summary.failed} failed ===\n`);
process.exit(summary.failed === 0 ? 0 : 1);
