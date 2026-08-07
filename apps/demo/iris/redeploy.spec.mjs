// Declarative Iris spec — binds to signals + testids, never DOM structure.
// Run with: node apps/demo/iris/run.mjs   (headed, presenter HUD on, real input)
// Demo pacing: set IRIS_DEMO_PACE_MS=1200 to slow each step so a viewer can register it.
// Default (0) keeps it fast for CI.
import { irisTest } from '../../../packages/test/dist/index.js';

const PACE_MS = Number(process.env.IRIS_DEMO_PACE_MS ?? 0);
const beat = () => new Promise((r) => setTimeout(r, PACE_MS));

// 1) Sign in and land on the deployments dashboard.
irisTest('sign in opens the dashboard', async (t) => {
  await beat();
  await t.actAndWait('login-submit', 'click', {
    kind: 'element',
    query: { testid: 'nav-deployments' },
    state: 'visible',
  });
  await beat();
  await t.actAndWait('nav-deployments', 'click', {
    kind: 'element',
    query: { testid: 'deploy-list' },
    state: 'visible',
  });
  await beat();
  await t.expectElement({ testid: 'deploy-list' }, 'visible');
});

// 2) The hero check: a Redeploy must ACTUALLY succeed — 200, signal committed, no errors.
//    On the buggy build (missing auth header) this fails with the real evidence.
irisTest('redeploy actually succeeds', async (t) => {
  await beat();
  await t.act('row-menu-trigger-4000', 'click');
  await beat();
  await t.actAndWait('redeploy-4000', 'click', {
    kind: 'net',
    method: 'POST',
    urlContains: '/api/redeploy',
  });
  await beat();
  await t.expectNet('POST', '/api/redeploy', 200);
  await t.expectSignal('deploy:redeployed');
  await t.expectNoConsoleErrors();
});
