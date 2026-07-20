# Fix-loop ablation — run log

Real cells executed via the harness (`run-fix-loop.mjs`) with live Claude Code subagents as the
`fixAgent`, and the deterministic `verify.isFixed` oracle. Each cell: inject the bug → agent fixes →
deterministic re-check → revert (bench-app verified clean after each).

## Run 1 — WITHOUT-RETICLE baseline (2026-07-21, model: general-purpose subagent)

The control condition: the agent debugs from source only, no runtime/Reticle tools.

| bug | fixed | tokens | tool calls | note |
| --- | --- | --- | --- | --- |
| silent-dom-regression | ✅ | 32,992 | 3 | spotted `.slice(0,-1)` dropping a KPI card |
| signal-contract-violation | ✅ | 35,028 | 6 | code archaeology: sibling actions emit signals, nav didn't |

**Baseline (n=2): 2/2 fixed · avg 34,010 tokens · avg 4.5 tool calls.**

Notes:
- The loop ran end-to-end with real agents and the deterministic oracle — this is real Layer B execution,
  not a simulation. bench-app was git-clean after every cell.
- The capable control agent solved even the invisible signal-contract bug via grep/code-reading — a
  reminder to run the full n=8 for signal, not to over-read a 2-cell sample.

## Remaining — WITH-RETICLE condition + full n=8

The with-Reticle condition needs the bench-app booted + a **`feat/v2.2.0`** Reticle daemon + the browser
SDK connected, so the subagent's `reticle_observe`/`assert` see the dropped card/signal. That live
setup + the full 8-bug × 2-condition matrix is the operator-authorized budget spend that yields the
headline WITH-vs-WITHOUT delta. The harness (`runAblation(fixAgent)`) runs it once the daemon is wired.
