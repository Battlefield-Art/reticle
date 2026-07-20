# Fix-loop ablation — run log

Real cells executed via the harness (`run-fix-loop.mjs` pattern) with live Claude Code subagents as the
`fixAgent` and the deterministic `verify.isFixed` oracle. Each cell: inject the bug → agent fixes →
deterministic re-check → revert (bench-app verified git-clean after every cell). The WITH-RETICLE cells
drove the **live, `feat/v2.2.0`-instrumented** bench-app (session connected to the branch daemon on 4460,
separate from the operator's cloud-app session, which was never touched).

## Run — full 2-bug matrix, both conditions (2026-07-21, general-purpose subagents)

| bug | condition | fixed | tokens | tool calls |
| --- | --- | --- | --- | --- |
| silent-dom-regression (visible: dropped KPI card) | without-reticle | ✅ | 32,992 | 3 |
| silent-dom-regression | **with-reticle** | ✅ | 41,531 | 13 |
| signal-contract-violation (invisible: dropped nav signal, UI fine) | without-reticle | ✅ | 35,028 | 6 |
| signal-contract-violation | **with-reticle** | ✅ | 58,329 | 42 |

**Delta (n=2, single model, both conditions):**

| condition | fixed rate | avg tokens | avg tool calls |
| --- | --- | --- | --- |
| without-reticle | **2/2 (100%)** | 34,010 | 4.5 |
| with-reticle | **2/2 (100%)** | 49,930 | 27.5 |

## Honest reading (per the plan: "publish honestly either way")

- **Both conditions fixed both bugs.** On this tiny sample with a *capable code-reading agent*, WITHOUT
  Reticle was **cheaper** — the agent found both regressions (even the invisible dropped-signal one) by
  grep/code-archaeology, while the Reticle agent paid navigation + live-observation overhead.
- **Reticle's mechanism worked as designed:** for the invisible signal bug, the with-Reticle agent used
  `reticle_assert { kind: "signal", name: "nav:changed" }` → `pass:false, "no signal matched"` and
  `reticle_observe` → `signals: 0` to *deterministically confirm* the regression the DOM/console/network
  channels all reported healthy. That confirmation is the product thesis in action — but on these two
  bugs a strong agent reached the same fix without it.
- **This is n=2, one model, capable-agent — NOT the release verdict.** The plan's number needs the full
  n=8 matrix, ideally multiple models/temperatures, and it should separate *visible* from *invisible*
  bugs (Reticle's expected edge is invisible/consequence bugs on WEAKER agents that can't code-archaeologize).
  Run `runAblation(fixAgent)` over all 8 injected regressions to produce the shippable number.

## Reproduce

```bash
# Deterministic harness self-check (no agent, no budget):
node bench/fix-loop/run-fix-loop.mjs --selftest

# With-Reticle live setup used for this run:
#   1) daemon: feat/v2.2.0 packages/server on :4460 (the session MCP already points here)
#   2) bench-app: cd apps/bench-app && RETICLE_PORT=4460 VITE_RETICLE_TOKEN="$(cat ~/.reticle/pairing-token)" pnpm dev
#   3) open http://localhost:<vite-port>/ in a browser → SDK connects as a NEW session
#   4) inject a bug, hand the running session id to a fix-agent, re-check with verify.isFixed, revert.
```
