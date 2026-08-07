// A guided, ~1-minute tour that drives the whole dashboard like a real user, verifying
// real outcomes (signals, network, drawer, console) at each stop. Paced for recording.
// Assumes the FIXED build (redeploy works). Run with: node apps/demo/iris/run.mjs
// Pace each step with IRIS_DEMO_PACE_MS (default 2500ms here so the tour reads naturally).
import { irisTest } from '../../../packages/test/dist/index.js';

const PACE_MS = Number(process.env.IRIS_DEMO_PACE_MS ?? 2500);
const beat = (mult = 1) => new Promise((r) => setTimeout(r, PACE_MS * mult));

irisTest('guided tour of the dashboard', async (t) => {
  // — Sign in —
  await beat();
  await t.actAndWait('login-submit', 'click', {
    kind: 'element',
    query: { testid: 'nav-deployments' },
    state: 'visible',
  });
  await beat();

  // — Overview: glance at the KPIs —
  await t.expectElement({ testid: 'kpi-deploys' }, 'visible');
  await beat();

  // — Go to Deployments —
  await t.actAndWait('nav-deployments', 'click', {
    kind: 'element',
    query: { testid: 'deploy-list' },
    state: 'visible',
  });
  await beat();

  // — Open a deployment's detail drawer, read it, close it —
  await t.actAndWait('open-detail-4000', 'click', {
    kind: 'element',
    query: { testid: 'drawer' },
    state: 'visible',
  });
  await beat();
  await t.expectElement({ testid: 'drawer' }, 'visible');
  await beat();
  await t.act('drawer-close', 'click');
  await beat();

  // — Redeploy that service, and verify it actually committed (200 + signal, no errors) —
  await t.act('row-menu-trigger-4000', 'click');
  await beat();
  await t.actAndWait('redeploy-4000', 'click', {
    kind: 'net',
    method: 'POST',
    urlContains: '/api/redeploy',
  });
  await beat();
  await t.expectSignal('deploy:redeployed');
  await t.expectNoConsoleErrors();
  await beat();

  // — Filter the list by typing, then clear it —
  await t.act('filter-search', 'type', { text: 'api' });
  await beat();
  await t.expectElement({ testid: 'deploy-list' }, 'visible');
  await beat();
  await t.act('filter-search', 'clear');
  await beat();

  // — Compose: write a prompt and generate a script —
  await t.actAndWait('nav-compose', 'click', {
    kind: 'element',
    query: { testid: 'compose-prompt' },
    state: 'visible',
  });
  await beat();
  await t.act('compose-prompt', 'type', {
    text: 'Announce the new redeploy button to our users',
  });
  await beat();
  await t.actAndWait('compose-generate', 'click', {
    kind: 'net',
    method: 'POST',
    urlContains: '/api/generate-script',
    status: 200,
  });
  await beat();
  await t.expectElement({ testid: 'compose-result' }, 'visible');
  await t.expectSignal('compose:generated');
  await beat();

  // — Diagnostics: trigger real failure modes and confirm Iris sees them —
  await t.actAndWait('nav-diagnostics', 'click', {
    kind: 'element',
    query: { testid: 'fault-500' },
    state: 'visible',
  });
  await beat();
  await t.actAndWait('fault-500', 'click', {
    kind: 'signal',
    name: 'fault:injected',
    dataMatches: { status: 500 },
  });
  await beat();

  // — Command center: open it as the finale —
  await t.actAndWait('cmdk-open', 'click', {
    kind: 'signal',
    name: 'palette:opened',
  });
  await beat();
  await t.expectElement({ testid: 'palette' }, 'visible');
  await beat();
});
