#!/usr/bin/env bash
# Build what the desktop battery needs, then run it.
#
# Nothing to boot here — each desktop spec starts its own runtime and waits for it to DIAL the
# bridge, which is the direction that makes a desktop app a desktop app. What this script does
# provide is the two things a spec cannot conjure: a pairing token, and a PACKAGED Tauri binary
# (Tauri embeds its frontend at COMPILE time, so the Rust build has to follow the Vite build — get
# that order wrong and the app boots to a blank window with no error anywhere).
#
# On Linux, run this under `xvfb-run -a`: both runtimes need a display to create a window at all,
# even one that is never shown.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The battery is not a user — keep its daemons/tool calls out of the adoption metrics.
export RETICLE_TELEMETRY=0
# And say so on every event that does get emitted. `CI` is the only signal an event has for
# "this was a pipeline", it is set by the runner and by nothing else, so a battery driven from a
# laptop or a cloud agent sandbox reported itself as a person at a machine.
export CI=1

TOKEN_DIR="${RETICLE_PAIRING_TOKEN_DIR:-$HOME/.reticle}"
TOKEN_FILE="$TOKEN_DIR/pairing-token"
if [ ! -s "$TOKEN_FILE" ]; then
  mkdir -p "$TOKEN_DIR" && chmod 700 "$TOKEN_DIR"
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi
export RETICLE_PORT=4400
export VITE_RETICLE_TOKEN="$(cat "$TOKEN_FILE")"

echo "==> building the packaged Tauri smoke app (vite build, then cargo — that order matters)"
pnpm --filter @reticlehq/tauri-smoke exec tauri build --no-bundle || {
  echo "tauri build failed — it needs a Rust toolchain, and on Linux webkit2gtk-4.1 + libsoup-3 dev packages"
  exit 1
}

echo "==> running desktop battery"
node apps/e2e/run.mjs --desktop
