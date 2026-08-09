import { reticleTest, bootSession, runSpecs, createTestContext } from '@reticlehq/test';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

reticleTest('hover reveals words — guarded by real input', async (t) => {
  await t.expectInputModeReal();              // skips-with-reason if synthetic; passes under reticle drive
  await t.act('smart-sentence', 'hover');
  await t.expectElement({ testid: 'word:0' }, 'visible');
});
reticleTest('add-task grows the list', async (t) => {
  await t.act('add-task', 'click');
  await t.expectElement({ testid: 'task-list' }, 'visible');
});
reticleTest('ping fires GET /api/ping 200 and opens the modal', async (t) => {
  await t.actAndWait('ping-button', 'click', { kind: 'net', method: 'GET', urlContains: '/api/ping', status: 200 });
  await t.expectElement({ testid: 'reply-modal' }, 'visible');
});

console.log('\n=== @reticlehq/test running 3 specs headless via reticle drive ===');
const booted = await bootSession({ driveUrl: 'http://localhost:3100/', headless: true });
// Wait for THE session these specs address, not for any session at all.
//
// `length > 0` was satisfied by whatever happened to be connected — including an unrelated app tab
// a developer had open — so the specs then ran against a bridge where `next-smoke` had not arrived
// yet and every one failed with "no connected session with id 'next-smoke'". The app is fine; the
// wait was asking the wrong question, which is the same mistake as asserting on a session you do
// not own.
const NEEDED_SESSION = 'next-smoke';
let ready = false;
for (let i = 0; i < 200 && !ready; i++) {
  const s = await booted.invoke('reticle_sessions', {});
  ready = (s.sessions ?? []).some((session) => NEEDED_SESSION === (session.sessionId ?? session.id));
  if (!ready) await sleep(50);
}
if (!ready) {
  console.log(`\n❌ '${NEEDED_SESSION}' never connected — the specs below would all fail for that reason, not their own.`);
  process.exit(1);
}
const print = (l) => process.stdout.write('   ' + l + '\n');
const { summary } = await runSpecs({
  invoke: booted.invoke,
  now: () => Date.now(),
  buildContext: (invoke) => createTestContext(invoke, { sessionId: 'next-smoke' }),
  print,
});
console.log(`\n${summary.ok ? '✅ @reticlehq/test SUITE GREEN' : '❌ FAILED'}  passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped}`);
await booted.close();
process.exit(summary.failed === 0 ? 0 : 1);
