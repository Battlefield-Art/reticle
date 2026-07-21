# v2.1.0 → v2.2.0 cost delta (WITH-Reticle)

The fix-loop ablation ran WITH-Reticle against **published v2.1.0** (`@reticlehq/server@latest`), NOT
v2.2.0 (84 unpublished branch commits). So the published numbers (opus ~28 calls / 49k tok; haiku ~30
calls / 46k tok) are the **v2.1.0 baseline**. The question this file answers: does v2.2.0's richer output
make the loop more expensive?

## Measured: per-act result-shape cost (direct, deterministic)

v2.2.0 adds a bounded causal summary + honesty block to **every** `act_and_wait` result (green path; the
divergence capsule is red-only and excluded here). Measured on a real captured act window (o200k proxy
tokens):

| | tokens/act | chars |
| --- | --- | --- |
| v2.1.0 result (effect + verdict + trace) | ~34 | 111 |
| **v2.2.0 added block** (summary + honesty) | **~128** | 449 |
| v2.2.0 full result | ~162 | — |

So each green act costs **~128 more output tokens** under v2.2.0. Over a ~14-act fix that is ~1.8k added
tokens — roughly **+4% of the per-act response**, modest in absolute terms.

## What this does NOT capture (needs a live agent run)

The full agent-loop cost has two countervailing terms this direct measurement can't resolve:
- **(−) Surface shrink**: v2.2.0 retired 3 MCP tools; tool *definitions* are re-sent every turn, so a
  smaller surface is a per-turn saving that compounds across the loop — pulls total cost DOWN.
- **(−/+) Call count**: a richer per-act result (diffs, honesty, coverage in one call) may let the agent
  conclude in FEWER calls (less polling) — or the extra detail may cost re-reading. Only a live run's
  `usage.input_tokens` + tool-call count settles the net direction.

## Status

- **Per-act result cost**: measured, +~128 tok/act (this file).
- **Full loop delta (tokens + call count, v2.1.0 vs v2.2.0)**: NOT run. It needs the session's Reticle MCP
  wired to the v2.2.0 daemon from the start; swapping the daemon mid-session drops the stdio↔SSE proxy
  connection irrecoverably. Run in a fresh session whose MCP points at the local v2.2.0 build, re-execute
  the WITH-Reticle cells, and compare to the v2.1.0 baseline above.
