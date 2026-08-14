#!/usr/bin/env bash
# Boot api + bench-app (the dashboard fixture) + next-smoke, wait for health, run the e2e battery, tear
# down. The dashboard specs (real-world-tests, multi-agent-lease) drive @reticlehq/bench-app on :4310 —
# it carries the login + deployments/compose/diagnostics surface those specs exercise. bench-app dials
# the per-spec bridge via RETICLE_PORT and presents the pairing token via VITE_RETICLE_TOKEN.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The battery is not a user — keep its daemons/tool calls out of the adoption metrics.
export RETICLE_TELEMETRY=0
# And say so on every event that does get emitted. `CI` is the only signal an event has for
# "this was a pipeline", it is set by the runner and by nothing else, so a battery driven from a
# laptop or a cloud agent sandbox reported itself as a person at a machine.
export CI=1

# Provision the bridge pairing token BEFORE the dev servers boot. next-smoke's withReticle reads it at
# `next dev` config load (before any per-spec bridge exists) to inline into its client connect; the
# per-spec bridges (start()) read the same file. Mirrors the real daemon-first workflow.
TOKEN_DIR="${RETICLE_PAIRING_TOKEN_DIR:-$HOME/.reticle}"
TOKEN_FILE="$TOKEN_DIR/pairing-token"
if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$TOKEN_DIR" && chmod 700 "$TOKEN_DIR"
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

echo "==> starting api (:8787), bench-app (:4310), next-smoke (:3100)"
REFLECT_MS=6000 node apps/api/server.mjs > /tmp/e2e-api.log 2>&1 &
API=$!
# bench-app on :4310, dialing the per-spec bridge (:4400) and presenting the token the bridge requires.
RETICLE_PORT=4400 VITE_RETICLE_TOKEN="$(cat "$TOKEN_FILE")" \
  pnpm --filter @reticlehq/bench-app exec vite --port 4310 --strictPort > /tmp/e2e-demo.log 2>&1 &
DEMO=$!
pnpm --filter @reticlehq/next-smoke dev > /tmp/e2e-next.log 2>&1 &
NEXT=$!
# Free the PORTS, not just the pids we happen to hold.
#
# Each of these was started through `pnpm --filter … exec`, so `$NEXT` is a pnpm wrapper and the
# thing actually bound to :3100 is its `next-server` grandchild. Killing the wrapper orphans it: the
# CI retry then booted into `EADDRINUSE: :::3100`, next dev exited instantly, and the second attempt
# failed for a reason that had nothing to do with the first. The runner's own orphan sweep named the
# survivor — `next-server (v15.5.22)` — after the job had already gone red.
#
# `lsof -ti tcp:PORT` is on both the ubuntu runner and macOS, and asks the only question that
# matters: is anything still holding the port the next attempt needs.
E2E_PORTS='8787 4310 3100'
cleanup() {
  kill "$API" "$DEMO" "$NEXT" 2>/dev/null || true
  sleep 1
  for port in $E2E_PORTS; do
    lsof -ti "tcp:$port" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  done
}
trap cleanup EXIT

echo "==> waiting for servers"
for _ in $(seq 1 120); do
  curl -s -o /dev/null http://localhost:8787/api/health \
    && curl -s -o /dev/null http://localhost:4310 \
    && curl -s -o /dev/null http://localhost:3100 \
    && break
  sleep 2
done
curl -s -o /dev/null http://localhost:8787/api/health || { echo "api never came up"; cat /tmp/e2e-api.log; exit 1; }
curl -s -o /dev/null http://localhost:4310 || { echo "bench-app never came up"; cat /tmp/e2e-demo.log; exit 1; }
curl -s -o /dev/null http://localhost:3100 || { echo "next never came up"; cat /tmp/e2e-next.log; exit 1; }

# A port that ANSWERS is not the same as OUR app answering. `next dev` exits instantly with
# EADDRINUSE when something else already holds :3100, and the curl above then happily succeeds
# against that stranger — so the whole battery drove somebody else's app. Measured: every next-smoke
# spec failed with "no connected session with id 'next-smoke'" (that app connects with a per-tab id),
# which reads exactly like a product defect and is not one. The servers we started must still be
# ALIVE; if one is not, say which, and say why.
for pair in "$API:api:/tmp/e2e-api.log" "$DEMO:bench-app:/tmp/e2e-demo.log" "$NEXT:next-smoke:/tmp/e2e-next.log"; do
  pid="${pair%%:*}"; rest="${pair#*:}"; name="${rest%%:*}"; log="${rest#*:}"
  kill -0 "$pid" 2>/dev/null && continue
  echo "==> $name died during boot — the battery would run against whatever else holds its port:"
  cat "$log"
  exit 1
done

echo "==> running e2e battery"
node apps/e2e/run.mjs
BATTERY_STATUS=$?

# The soak runs HERE because this is the only place a real app is already up and paired. It answers
# the question the battery cannot: not "does a tool work" but "how often does it fail", which needs
# repetition and idle time rather than one call. Modest numbers — this is the merge-gate sample, and
# `pnpm gate:soak:record` is the longer run that re-records the baseline before a release.
echo "==> soak + tool profile"
node apps/e2e/soak.mjs --rounds "${SOAK_ROUNDS:-10}" --idle-ms "${SOAK_IDLE_MS:-1000}"
SOAK_STATUS=$?

# Report the battery's verdict first when both fail: it covers far more ground, so it is the more
# useful thing to read. Neither is allowed to mask the other.
if [ "$BATTERY_STATUS" -ne 0 ]; then exit "$BATTERY_STATUS"; fi
exit "$SOAK_STATUS"
