# Reticle benchmark scorecard

Every number here is read from a run artifact on disk. Anything not measured says so and names the
command that would produce it — there is deliberately no way to hand-write a figure into this file.

## 1. Detection

| harness | bugs | caught | of what it can catch | **false positives on clean** | avg bytes/bug | avg ms/bug |
|---|---|---|---|---|---|---|
| reticle-script | 85 | 78 | 78/81 | **0** | 11771 | 3589 |
| playwright-script | 85 | 57 | 55/57 | **0** | 8234 | 32414 |

False positives are the column that matters most: a verification tool that flags a healthy build
is worse than no tool, because it trains the team to ignore it.

### Catch rate by severity

Severity is graded by consequence to the user, not by how hard the bug is to find.

| severity | bugs | reticle | playwright | caught by neither |
|---|---|---|---|---|
| critical | 25 | 24 | 8 | 0 |
| high | 29 | 29 | 23 | 0 |
| medium | 24 | 24 | 23 | 0 |
| low | 5 | 1 | 3 | 2 |

## 2. Cost per decision and per flow

One "decision" is one bug verdict: drive the app, observe, decide caught/not. Median and p90 are
reported rather than the mean, because a single slow outlier makes a mean meaningless here.

| harness | decisions | median ms | p90 ms | total bytes pulled |
|---|---|---|---|---|
| reticle-script | 170 | 3318 | 6422 | 2,001,978 |
| playwright-script | 170 | 31937 | 34655 | 1,308,742 |

**Median decision latency: 9.6x faster** (3318ms vs 31937ms).
Both harnesses are deterministic scripts with no model in the loop, so this compares the
OBSERVATION path only — not agent reasoning, which dominates a real loop and is measured separately.

### Per-turn token cost of the tool surface

_not measured — run `node bench/first-drive/measure.mjs`_

## 3. Does a report say where to fix it?

Detection is the easy half. The half that decides whether a human gets pulled in is whether the
agent knows which file to open — worth more downstream than any amount of extra description of the
symptom. Ground truth is derived by scanning the fixture's own source, not hand-maintained.

| measure | result |
|---|---|
| bugs scored | 85 / 85 |
| report carries a `file:line` | **83** (98%) |
| names the RIGHT file | **79** (95% of those present) |

No competitor column: a browser-automation tool's stack trace points at its own test, never at
the app source. That is the asymmetry — but it also means there is no baseline to beat, so this
is a capability measurement, not a head-to-head.

## 4. Serial vs parallel

_not measured — run `node bench/parallel-suite/measure.mjs`_

**The same mechanism, driven through Playwright:** 29380 ms serial vs 7201 ms across 4 contexts — **4.08x**.

> So concurrency is not a Reticle capability. `browser.newContext()` is available to anyone, and
> gets most of the same win. What is ours is the pooling and lease reclamation around it, which
> is a convenience, not a moat. Any claim built on the speed-up alone is overstated.

## 5. SDK overhead on the observed app

An observability layer that slows the app corrupts its own performance verdicts.

_not measured — run `node bench/overhead/measure.mjs`_

## 6. What this scorecard does NOT show

Stated as plainly as the wins, because a scorecard without this section is marketing.

- **Does an agent fix bugs faster with Reticle?** Not established. The one attempt measured no
  fix-rate lift and roughly 6x the tool calls, on a fixture small enough that the result could not
  settle the question either way. Every number above is a DETECTION and COST measurement, not an
  outcome measurement.
- **Agent-loop numbers.** The head-to-head above runs deterministic scripts with no model, which
  isolates the tool but omits the reasoning cost that dominates a real loop.
- **Cross-tool concurrency.** See section 3.
- **Competitor harness quality.** Every Playwright branch is code we wrote. We have already found
  six cases where it under-performed because a check was never written rather than because the
  capability was missing. Treat any Reticle-only claim as provisional until someone adversarial to
  us has attacked the competitor side.
- **A single run.** Reproducibility is checked with `compare-runs.mjs`; one run is an anecdote.

