# Fix-loop ablation — run log

Real cells executed via the harness (`run-fix-loop.mjs` pattern) with live Claude Code subagents as the
`fixAgent` and the deterministic `verify.isFixed` oracle. Each cell: inject the bug → agent fixes →
deterministic re-check (`verify.mjs`: injected marker gone) → revert (bench-app verified git-clean after
every cell). The WITH-RETICLE cells drove the **live, `feat/v2.2.0`-instrumented** bench-app on
`localhost:4313` (session connected to the branch daemon on 4460, separate from the operator's cloud-app
session on 4320, which was never touched). The WITHOUT-RETICLE cells read source only — no app boot, no
Reticle tools.

## Run — full n=8 matrix, both conditions (2026-07-21, general-purpose subagents, single model)

visible = a human/agent can see the defect in the DOM/UI; invisible = DOM/console/network look healthy.

| bug | visibility | condition | fixed | tokens | tool calls |
| --- | --- | --- | --- | --- | --- |
| silent-dom-regression (dropped KPI card) | visible | without | ✅ | 32,992 | 3 |
| silent-dom-regression | visible | **with** | ✅ | 41,531 | 13 |
| signal-contract-violation (dropped nav signal, UI fine) | **invisible** | without | ✅ | 35,028 | 6 |
| signal-contract-violation | **invisible** | **with** | ✅ | 58,329 | 42 |
| route-transition-break (compose view unreachable) | visible | without | ✅ | 36,363 | 5 |
| route-transition-break | visible | **with** | ✅ | 46,728 | 24 |
| missing-modal (new-deploy button dead) | visible | without | ✅ | 40,447 | 6 |
| missing-modal | visible | **with** | ✅ | 49,023 | 41 |
| broken-form-validation (empty service submits) | semi | without | ✅ | 34,023 | 4 |
| broken-form-validation | semi | **with** | ✅ | 48,258 | 32 |
| cross-component-regression (filter → table dead) | visible | without | ✅ | 37,159 | 4 |
| cross-component-regression | visible | **with** | ✅ | 61,134 | 31 |
| layout-shift (grid 1.6fr/1fr → 3×1fr) | visible | without | ✅ | 32,929 | 4 |
| layout-shift | visible | **with** | ✅ | 46,011 | 27 |
| network-timeout (spurious hanging fault button) | visible | without | ✅ | 32,251 | 3 |
| network-timeout | visible | **with** | ✅ | 40,623 | 15 |

**Delta (n=8, single model, capable code-reading agent):**

| condition | fixed rate | avg tokens | avg tool calls |
| --- | --- | --- | --- |
| without-reticle | **8/8 (100%)** | 35,149 | 4.4 |
| with-reticle | **8/8 (100%)** | 48,955 | 28.1 |

Reticle cost more on **every single bug** — ~1.39× tokens and ~6.4× tool calls — because live-driving the
app (navigate, snapshot, act, observe, re-verify after HMR) is inherently more calls than reading source.

## Honest reading (per the plan: "publish honestly either way")

- **Both conditions fixed all 8 bugs.** With a *capable code-reading agent*, WITHOUT Reticle was cheaper on
  every bug. The agent localized each regression — even the invisible dropped-signal one — by grep/code
  archaeology, while the Reticle agent additionally paid navigation + live-observation + post-HMR re-verify
  overhead.
- **Reticle did not win on cost even on its home turf.** `signal-contract-violation` is the one truly
  *invisible* bug (DOM/console/network all healthy). WITHOUT still fixed it (35k tok) by reading the store
  and noticing the dropped `emit(NAV_CHANGED)`. WITH fixed it too (58k tok) and additionally *proved* the
  regression live: `reticle_assert { kind:"signal", name:"nav:changed" } → pass:false` and
  `reticle_observe → signals:0` while every other channel read healthy. That confirmation is the product
  thesis in action — but a strong agent reached the same source fix without it.
- **What this ablation does NOT measure (the real edge):** these agents can read the whole ~small fixture
  and reason to the fix. Reticle's expected advantage is on (a) *weaker/cheaper* agents that cannot
  code-archaeologize a large unfamiliar app, (b) apps too large to hold in context where "which of 40k
  lines broke" needs runtime narrowing, and (c) *acceptance/regression-gating in CI* where the deterministic
  live assertion — not the source fix — is the deliverable. None of those are captured by "one capable model,
  one tiny fixture, fix-the-injected-bug."
- **Verdict for the release:** on this benchmark Reticle is a **cost regression, not a fix-rate gain**, and we
  publish that. The honest pitch is *deterministic proof of invisible/consequence regressions*, not *cheaper
  bug-fixing by a strong agent*. The number to chase next is (a) a weaker fix model and (b) a large app where
  source-only localization fails.

## Reproduce

```bash
# Deterministic harness self-check (no agent, no budget):
node bench/fix-loop/run-fix-loop.mjs --selftest

# With-Reticle live setup used for this run:
#   1) daemon: feat/v2.2.0 packages/server on :4460 (the session MCP already points here)
#   2) bench-app: cd apps/bench-app && RETICLE_PORT=4460 VITE_RETICLE_TOKEN="$(cat ~/.reticle/pairing-token)" pnpm dev
#   3) open http://localhost:<vite-port>/ in a browser → SDK connects as a NEW session
#      (the session id ROTATES on every HMR reload — resolve it fresh via reticle_sessions each cell)
#   4) inject a bug, hand the running session to a fix-agent, re-check with verify.isFixed, revert.
```
