# Suite wall-time: sequential vs parallel (§5.12 / W14.2)

Runs the **real** `reticle_flow_verify` handler twice against a live app — sequential (one shared tab)
vs `{ parallel: N }` (one leased isolated context per flow) — and reports wall-time, speedup, and how the
two verdicts differ.

```bash
# 1. bench-app running and pointed at the port this script owns:
#    cd apps/bench-app && RETICLE_PORT=4491 pnpm dev
# 2. flows saved in .reticle/flows/
RETICLE_PORT=4491 node bench/parallel-suite/measure.mjs http://localhost:4312 4
```

The script owns its own bridge, so leased tabs register with **it** rather than with whatever external
daemon happens to be running.

## Measured (2026-07-21, 4 flows, parallelism 4, headless)

| mode | wall-time | passed |
| --- | --- | --- |
| sequential (shared tab) | 4,294 ms | 0/4 |
| **parallel (4 leased contexts)** | **1,807 ms** | **4/4** |
| speedup | **2.38×** | |

Leases were observed connecting and releasing cleanly (`session_connected` / `session_disconnected` for
each of the four contexts), so this exercises the real pool path, not a stub.

## The verdict difference is the point, not a bug

Parallel passed **more** than sequential. That is expected and desirable:

- **Sequential replays every flow against the SAME tab.** These flows each sign in first, so flow 1
  authenticates and flows 2–4 then find no "Sign in" button and drift. One-tab replay is
  **order-dependent by construction** — a classic shared-fixture problem.
- **Parallel gives each flow its own isolated context**, so a flow that assumes a clean app finally gets
  one, and each flow is independently verifiable.

So isolation is a **correctness** feature, not only a speed one. The script encodes this asymmetry: it
fails only when parallel passes **fewer** flows than sequential, because that — not the reverse — would
mean isolation is leaking or flows are racing. An earlier version asserted "verdicts must agree", which
wrongly treated the contaminated sequential run as ground truth.

## Why 2.38× and not 4×

Each lease pays a fixed cost: launch an isolated context, navigate, and wait for the SDK to register.
With only four short flows that setup dominates. The speedup grows with suite size and flow duration —
which is exactly the 200-flow dashboard case W14.2 targets. Treat 2.38× as the floor for a tiny suite,
not the ceiling.
