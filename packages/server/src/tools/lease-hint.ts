/**
 * Why a leased tab did not dial in.
 *
 * The lease pool opens the app itself, which is what makes it the highest-value path in the product
 * — it does not wait for the human's tab. Measured over a day: lease sessions had a median of 30
 * tool calls and produced 46% of all bugs found, against a median of 1 call for everything else.
 *
 * When it fails it is almost always a PORT MISMATCH: the tab loads, and the app's SDK dials the port
 * it was BUILT with, which need not be the daemon that issued the lease. Verified by driving it —
 * against a matching daemon `acquire` returns ready:true and the session is driveable immediately;
 * against a different one the tab connects to the OTHER daemon instead.
 *
 * The old hint asked "is <url> running with @reticlehq/core enabled?", which is the one thing that
 * cannot be in doubt: the pool just navigated a real browser to it. Naming the true cause first is
 * the difference between a two-minute fix and abandoning the best path Reticle has.
 */
export function leaseNotConnectedHint(url: string, port: number): string {
  return (
    `the leased tab loaded ${url} but never dialled this daemon (port ${String(port)}). The usual ` +
    `cause is a PORT MISMATCH: the app's SDK connects to the port it was BUILT with, so a daemon on ` +
    `a different port never hears from it — check the app's reticle port (\`.reticle.json\`, ` +
    `RETICLE_PORT, or the build plugin's \`port\`) matches ${String(port)}, or start the daemon on ` +
    `the port the app expects. If the app carries no Reticle SDK at all, run \`reticle init\` in it ` +
    `first. The tab stays leased either way — release it with reticle_lease{action:"release"}.`
  );
}
