# Runbook — v2.1.0 → v2.2.0 WITH-Reticle cost delta (clean setup)

Goal: measure the FULL agent-loop cost (tokens **and** tool-call count) of the WITH-Reticle fix cells
against the **local v2.2.0** build, and compare to the v2.1.0 baseline already on record. The direct
per-act result cost (+~128 tok/act) is in `COST-DELTA.md`; this closes the loop-level number.

## Why last attempt failed (the trap to avoid)

`.mcp.json` already runs the LOCAL proxy (`node packages/server/dist/cli.js mcp`, `RETICLE_PORT=4460`).
But a proxy CONNECTS to whatever daemon is already listening on its port (the `isRunning(port)` check) and
only spawns a new one if the port is free. A **stale published daemon** was already on `:4460` (from an
earlier `reticle mcp` run), so the local proxy attached to *published v2.1.0*, not the local build.
Swapping the daemon mid-session then killed the stdio↔SSE proxy connection irrecoverably.

**Rule: the daemon identity is decided by whoever owns the port when the proxy starts — never by the MCP
command alone. Start from a CLEAN, DEDICATED port so the local proxy spawns the local daemon.**

## One-time setup (do this, then restart Claude Code)

1. Build everything (dist must be v2.2.0):
   ```bash
   pnpm -r --filter "@reticlehq/*" build
   ```
2. Point the Reticle MCP at a DEDICATED, never-shared port and confirm it uses the local cli. Edit
   `.mcp.json` → `mcpServers.reticle`:
   ```json
   { "command": "node", "args": ["packages/server/dist/cli.js", "mcp"], "env": { "RETICLE_PORT": "4480" } }
   ```
   (4480 is arbitrary — just one no other daemon uses. Do NOT reuse 4460; it collects stale daemons.)
3. Free the port so the proxy spawns a FRESH local daemon (not a leftover):
   ```bash
   bash bench/fix-loop/setup-v220-daemon.sh 4480   # frees the port + boots the bench-app on it
   ```
4. **Restart Claude Code** (or reconnect the MCP) so its `reticle` proxy re-reads `.mcp.json` and spawns
   the local v2.2.0 daemon on the clean port. This is the step that must happen with a clean port.

## Verify v2.2.0 is what's live (before spending any agent budget)

From the new session, sanity-check the daemon identity:
- `reticle_tools` → the list must **NOT** contain `reticle_version_info`, `reticle_apply_update`,
  `reticle_rollback` (retired in v2.2.0). If they appear, you're on published v2.1.0 — stop and fix the port.
- `reticle_sessions` → the bench-app session (`http://localhost:4313/`) is present.
- Drive one `act_and_wait` and confirm the result carries `summary`, `honesty`, and (on red) `capsule`
  fields — absent in v2.1.0.

## Run the cells

Same protocol as the recorded ablation (`results.md`), WITH-Reticle only, one model (use the same model as
the baseline column you compare against). For each bug: `inject(id)` → spawn a fix-agent that drives the
LIVE app via the reticle MCP → record `{fixed, tokens, toolCalls}` from the agent's usage → `revert(id)`.
The harness helpers:
```bash
node -e "require('./bench/harness/inject.mjs')"   # inject/revert/isFixed (see run-fix-loop.mjs)
```
Reuse the exact prompts from the prior run for comparability.

## Compare against the v2.1.0 baseline (already recorded, opus WITH-Reticle)

| bug | v2.1.0 tokens | v2.1.0 calls |
| --- | --- | --- |
| silent-dom-regression | 41,531 | 13 |
| signal-contract-violation | 58,329 | 42 |
| route-transition-break | 46,728 | 24 |
| missing-modal | 49,023 | 41 |
| broken-form-validation | 48,258 | 32 |
| cross-component-regression | 61,134 | 31 |
| layout-shift | 46,011 | 27 |
| network-timeout | 40,623 | 15 |
| **avg** | **48,955** | **28.1** |

Record the v2.2.0 column beside it. Expected shape of the answer: per-act result is ~128 tok richer, but
the surface shrink (−3 tool schemas/turn) and possibly fewer calls (richer results → less polling) push
the other way — the loop total decides the net. Publish it honestly either way in `results.md`.

## Teardown (leave the environment as you found it)

```bash
bash bench/fix-loop/setup-v220-daemon.sh --teardown 4480   # kills the local daemon + bench-app on 4480
```
Then restore `.mcp.json` `RETICLE_PORT` to its original value if you changed it, and restart Claude Code so
the default proxy comes back. Confirm every injected bug was reverted (`git status --short apps/bench-app`
must be clean).
