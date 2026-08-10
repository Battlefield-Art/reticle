# The release gate — plan and status

> What has to be true before a PR merges and before a release ships, why each piece exists, and what is built so far. Derived from [`system-map.md`](./system-map.md); the harness rules every tier obeys are in [`harness-rules.md`](../apps/e2e/harness-rules.md).

## Two gates, not one

|         | Merge gate                   | Release gate                                      |
| ------- | ---------------------------- | ------------------------------------------------- |
| Answers | does this PR break anything? | does this version work in the clients people use? |
| Runs    | every PR                     | on a release candidate                            |
| Who     | machines only                | machines + humans                                 |
| Budget  | minutes                      | hours                                             |

**They must stay separate.** A merge that waits on a human client matrix stalls every contribution until three people with three editors happen to be awake.

## Tiers

| Tier | Question | Who | When | Blocks |
| --- | --- | --- | --- | --- |
| 0 — repo | is the code internally consistent | Actions | every PR | merge |
| 1 — install | does it install into an app nobody instrumented | Actions, scaffolded apps | PRs touching install/wire | merge |
| 2 — ecosystem | does it survive third-party apps at real scale | `reticle-fixtures`, dispatch | 3×/week + release | release |
| 3 — conformance | does each MCP client actually work | humans + headless CLIs | release candidate | the tag |
| 4 — canary | does a real model still succeed | nightly, live LLM | nightly | nothing (alerts) |

**Tier 1 vs 2.** Tier 1 scaffolds a pristine app at CI time (`npm create vite`) — clean by construction, seconds to produce, catches install _regressions_, fast enough to block a PR. Tier 2 uses vendored production apps and catches install _complexity_. Conflating them produces a gate too slow to block and too shallow to trust.

**Tier 3 is the [CNCF conformance](https://github.com/cncf/k8s-conformance) model:** contributors do not _claim_ a client works, they run one command and submit its machine-generated output as a PR, which a bot validates before a human looks. Self-reported pass/fail cannot gate anything.

**No LLM in the merge path.** Deterministic tests on every commit; live-model evals nightly and alert-only. The `record → save → verify → heal` chain is what makes this possible — a flow is recorded once by an agent, then replayed forever with no model.

## The matrix, factored

3 OS × 6 clients × 8 frameworks × 2 runtimes = 288 combinations. Nobody runs that. Test each axis against a fixed baseline of the others instead: 3 + 6 + 8 + 2 = **19 runs, plus ~4 deliberately chosen full-stack combos** where axis interaction is most likely (Windows+Cursor+Next, macOS+Claude Code+Tauri, …). Publish the factoring, and say plainly which interactions are untested.

## Phases

### Phase 0 — the harness contract and the map — **done**

Nothing below is trustworthy until a gate result can be distinguished from a gate artifact.

- [x] `docs/system-map.md` — topology, connection sequence, tool graph, fragility inventory
- [x] `apps/e2e/harness-rules.md` — the four rules, with the incidents that produced each
- [x] `apps/e2e/gate-harness.mjs` — the rules as code: `portHolders`, `freePortSafely`, `startOwnedDaemon`, `watchTransport`, `attributeOutcome`, plus a self-check
- [x] `run.mjs` and `ci.yml` no longer kill client sockets on the bridge port

### Phase 1 — close the silent gaps already in reach

- [x] **Trace-shape assertions** — `apps/e2e/trace-shape.mjs` + `trace-shape-test`. One root span per callId, no nested span without a completed parent (the hang signature), no undeclared parentless `browser.command`, no `ok:false` without an error. Calibrated against a real 494-span run: silent there, fires on all four fault shapes.
- [x] **Daemon truthfulness (the port half)** — `daemon/port-presence.ts` gives a three-state answer (`daemon` / `foreign` / `free`) from two probes and no platform code. `serve` now refuses a foreign port and waits for a real bind before claiming success; `status` and `doctor` name the obstacle. Guarded by `daemon-port-honesty-test`, which squats the port and includes the free-port control. (#105, #112, #115)
- [x] **`daemon_alive` heartbeat** — `daemon/heartbeat.ts` beats unconditionally on a fixed cadence (30s, `RETICLE_HEARTBEAT_MS` to override) and `classifyDaemonLife` reads a log back into `alive` / `clean` / `signalled` / `died_silently` / `unknown`. A heartbeat nobody interprets is only log volume, so the reader ships with it and is exported for the gate. Guarded by `daemon-heartbeat-test`, which SIGKILLs a real daemon and includes the tidy-shutdown control. (#123)
- [x] **`observation_lost`** — a new `VerifiedReason`, matched above the `pass === false` clause, so a lost connection grades UNKNOWN instead of being reported as a failed assertion. Signalled by a structured flag from `waitForPredicate`, never by matching on `failureReason` (which is free prose about the app everywhere else it is produced). Threaded through the assert and wait paths too, not just act. (#124)
- [x] **Telemetry chokepoint coverage** — `tools/dispatch-chokepoint.test.ts` scans for any `.handler(` call outside `runTool` and fails unless it is declared with a stated reason and cost. Three exist today: family folding in `merge-tools.ts` (counted as the family, not the member), `verify-change-tools.ts` (inner `flow_verify` uncounted), and the bridge test harness. Two of those are known observability gaps — the value is that they are now _known_ and a fourth cannot arrive unnoticed. Verified by introducing a bypass and watching it redden.
- [x] **Specified transport faults** in place of `kill -9` — `apps/e2e/fault-proxy.mjs` (no dependency; toxiproxy is not installed and the battery is deliberately dependency-free) gives none / reset-peer / blackhole / latency / truncate over `node:net`, each proven distinguishable by its own self-check. `transport-faults-test` puts it between the MCP proxy and a real daemon and asserts the product claim: every call is ANSWERED and the stdio server survives. It also separates the two unanswered-call populations by timing — a queued call answered by the 20s queue timer, a call broken in flight answered in ~600ms via `sse_aborted`. A toxic breaks the connection and never the process, so the self-inflicted `kill -9` confusion is unreachable here.

### Phase 2 — the install gate

- [x] **Tier 1 — all three `init` paths** — `apps/e2e/install-gate.mjs` (`pnpm gate:install`), wired into CI as its own `install-gate` job. Scaffolds `npm create vite`, `create-next-app` (app router) and `create-next-app --no-app` (pages router), publishes this checkout to a local Verdaccio, lets **`init` do its own dependency install** from it, boots each app, opens it in a real browser and POLLS for a session. **3/3 scaffolds, 8/8 assertions each.** The pages-router path — no `app/` root layout, so connect must mount via `pages/_app` — is the one that once did nothing at all, silently.
  - `⚠` is an absolute zero, not a tolerated exemption. The earlier `file:`-wired version had to pass `--no-install` and then argue away the `⚠` it produced, which left the step most likely to regress as the one step untested.
  - A `package-lock.json` check confirms the SDK came from the local registry. Without it a scope typo silently measures PUBLISHED code — which is exactly the defect this work found in `docs/local-registry.md` (`@reticle:` vs `@reticlehq:`).
  - **Negative control, run FIRST in CI** (`pnpm gate:install:self-test`): every scaffold is mis-wired to a port the daemon is not on and every one must go RED. Verified — all three fail on the session assertion alone (7 passed, 1 failed), attributed FAIL rather than INCONCLUSIVE because the bridge was provably up. A guard that has never failed is not a guard.
  - `file:` wiring is a dead end and the reason is worth keeping: npm symlinks it, which Vite resolves and Next does not; `--install-links` copies instead and then cannot resolve `workspace:*` at all.
- [ ] Tier 2: `reticle-fixtures` via `repository_dispatch`, `vite-ecosystem-ci` style.
- [ ] Run-record schema + committed baseline, so "nothing broken" is a diff and not a threshold.
- [ ] Risk routing: path filters → tiers, auto-labelled.

### Phase 3 — the client matrix

**Blocked on `init` learning each client.** Today only Claude Code (`claude mcp add`) and Cursor (`~/.cursor/mcp.json`) are first-class; everything else gets a printed JSON snippet, so a `v2.5.0-<client>` artifact would measure the contributor's copy-paste rather than the product.

- [ ] `init` support per client in the matrix
- [ ] the per-client compat script: register → list tools → 5 calls → survive a daemon restart → capture the client's own error text (~3 minutes, identical everywhere)
- [ ] one-command run → run record → PR → bot validation
- [ ] generated `MATRIX.md` per release, crediting who verified what

### Phase 4 — rates, not booleans

- [ ] soak with a recorded stability rate (a held-open link; `mcpEvents` per N calls)
- [ ] per-tool latency and failure budgets (`bench/TOOL-PROFILE.md`)
- [ ] false-green scorecard as a standing gate against apps we did not write (#130)

Connection stability is a rate. A pass/fail cannot express "breaks a lot", and a number that is not recorded cannot regress.
