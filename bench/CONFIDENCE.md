# Confidence, per claim

A single "how confident are we" number would hide the only thing that matters: confidence is not
uniform across what this library claims. Some of it is repeated and controlled, some is one run, and
some is explicitly unmeasurable here. This table is what a confidence figure would be averaging over.

Every row is generated from an artifact on disk or names the run that produced it. **HIGH** means
repeated and controlled. **MEDIUM** means measured once, or measured without a control. **LOW** means
argued but not measured. **NONE** means we tried and could not.

## What Reticle claims

| # | Claim | Evidence | Confidence |
|---|---|---|---|
| 1 | Catches bugs a Playwright script misses | 85-bug registry, 2 full runs: 78/85 vs 57/85; **24/25 critical vs 8/25** | **HIGH** — repeated, competitor harness adversarially de-rigged, losses published |
| 2 | Does not flag healthy builds | 0 false positives on every clean variant, both runs; 2/2 false-positive traps held | **HIGH** — repeated |
| 3 | A failure names the file to open | 83/85 carry `file:line`; 79 name the exact file | **HIGH** — plus a control (0/22 with stamps stripped) proving the stamp causes it |
| 4 | That pointer is not obtainable another way | 0/5 recoverable via any other Reticle route, inspect included | **HIGH** — direct measurement, both conditions |
| 5 | It measurably reduces agent work | 22 → 12 tool calls (−45%), 6/6 fixed both conditions | **MEDIUM** — 3 bugs, 2 runs/cell, spread ±2. Scoped to a well-structured codebase |
| 6 | Adding the cause or a fix hint helps further | 10 and 11 tool calls vs 12 — inside the baseline's own spread | **NONE** — measured, does not resolve. Fix-hint surface deliberately not built |
| 7 | Instrumentation is affordable at scale | < 1.2 pp of main thread at 9,083 nodes, depth 27, 20 req/s | **HIGH** — three conditions, noise floor computed, budget stated |
| 8 | The agent gets an exact answer at scale | `count_only` returns 4,016 exact in 62 bytes / 46 ms on a 4,000-match page | **HIGH** — measured live, and the bug it replaced (total tool failure) is fixed |
| 9 | Verdicts do not rest on evidence we lost | 5 false-green paths closed; each fix reverted against a good build to prove it goes red | **HIGH** for the five found. **MEDIUM** that no sixth exists |
| 10 | Concurrency | 6.78x pooled — but Playwright's own `newContext` gets 4.08x | **HIGH**, and it is *not* a differentiator; the README says so |
| 11 | Works across frameworks | 15/15 e2e specs, bench-app + next-smoke | **MEDIUM** — restored this session after 4 had been dead; now guarded in the fast gate |

## What is NOT established

- **Fix-rate lift.** Row 5 measures agent WORK, not outcomes. Fix rate was 6/6 in both conditions —
  the pointer removed the search, it did not make the agent more capable. Nobody should quote a
  fix-rate improvement.
- **Magnitude on a badly-organised codebase.** Attempted twice in a package 10x the fixture (337
  files): 5 and 9 tool calls. This repo is too well-named to produce a hard localization case. The
  literature's large numbers come from unfamiliar repos with weak naming, which is a property of the
  codebase and not something a bigger fixture here simulates.
- **In-page network fidelity in attach mode.** Reticle reads `init.body` inside its own fetch
  wrapper, so anything patching fetch later — an interceptor started after connect(), a service
  worker, sendBeacon — rewrites requests invisibly. Fixed on the DRIVE path only (wire capture via
  CDP). Attach-mode sessions still have this blind spot.
- **That the false-green list is complete.** Five were found by auditing for one bug's *shape*. The
  audit found them; it cannot prove there is no sixth.

## The honest summary

The strongest claims are 1–4 and 7–8: detection, honesty on clean builds, localization, and behaviour
at scale. Those are repeated, controlled, and several are backed by a deliberate attempt to break
them.

The weakest is 5 — the one people will most want to quote. It is three bugs on a small, tidy
codebase. It is real, it is controlled, and it is small.

And row 6 is the one worth reading twice: **a planned feature was measured and dropped.** That is the
posture this table is meant to preserve. A benchmark whose only function is to justify what was
already going to be built is not a benchmark.
