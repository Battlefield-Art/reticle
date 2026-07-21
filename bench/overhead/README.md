# SDK overhead budget (§5.11)

> "An observability layer that slows the app corrupts its own perf verdicts."

Release bar: **total instrumentation overhead < 3% of main-thread time**, measured on the **hostile
fixture** — the page that never goes quiet (a ~10/s feed + a 60fps ticker + a large list), i.e. the worst
realistic case rather than a polite demo.

```bash
# bench-app must be running (default http://localhost:4312)
node bench/overhead/measure.mjs [url] [seconds]     # exit 0 = under budget
```

## Method

The same hostile page is loaded twice in one browser — once normally, once with `?no-hud` (which skips
Reticle's SDK entirely) — and Chrome's own cumulative `TaskDuration` metric is read over an identical
wall-clock window via CDP. Overhead is the difference expressed as a share of that window, so the figure
is **main-thread percentage points**, not a ratio against an arbitrary baseline. Condition order
alternates across repeats so warm-up/JIT drift cannot systematically favour either side, and the run
asserts it actually reached the churning view (a silent miss would measure an idle page and report a
flatteringly small number).

## Result (2026-07-22, 8s × 3 repeats, headless Chromium) — **BUDGET FAILING**

| | main-thread task time | busy |
| --- | --- | --- |
| SDK ON | 2.164 s | 27.0% |
| SDK OFF (`?no-hud`) | 1.696 s | 21.2% |
| measured difference | **+5.85 pp** | |
| **method noise floor** | ±1.83 pp | (same-condition run-to-run spread) |

**Instrumentation overhead: 5.85 pp — resolved above noise. Budget < 3%: FAIL.**

This is a regression against the prior result below, and it reproduces: three consecutive runs
measured +6.50, +5.30 and +5.85 pp, every one of them above that run's own noise floor.

Two things were ruled out rather than assumed:

- **It is not the scalar-first serialization change.** Reverting that one change and re-measuring gave
  +5.30 pp — indistinguishable from +6.50 at a ±2.58 pp noise floor. The change was restored.
- **It is not a one-off.** The sign is consistent across runs, unlike the prior result where the
  difference came out negative (the method hitting its resolution limit).

What is NOT yet established is which observer is responsible. The per-event candidates, none of them
measured individually: `new Error().stack` per network request, the document-wide capture-phase
animation/transition listeners, and the DOM observer watching `class` + `style` (which a
re-rendering framework churns constantly). **Do not quote an overhead number in any user-facing
material until this is resolved.** The 3% claim is currently unsupported.

## Prior result (2026-07-21, same method) — for comparison

| | main-thread task time | busy |
| --- | --- | --- |
| SDK ON | 1.632 s | 20.4% |
| SDK OFF (`?no-hud`) | 1.737 s | 21.7% |
| measured difference | −1.30 pp | |
| **method noise floor** | **±1.31 pp** | (same-condition run-to-run spread) |

**Instrumentation overhead: not resolvable above the noise floor → report as `< 1.3pp`. Budget < 3%: PASS.**

## Why the raw number is not the headline

The measured difference came out *negative* — the SDK cannot make the app faster, so that is the method
hitting its resolution limit, not a speedup. The script therefore computes its own noise floor from the
same-condition spread and refuses to present an unresolvable difference as a signed figure. Publishing
"−1.3% overhead" would be precisely the self-flattering perf claim this budget exists to prevent.

What this supports honestly: **on a continuously churning page, Reticle's instrumentation costs less than
~1.3 percentage points of main-thread time — under the 3% budget, and too small for this method to
separate from noise.** Resolving it more finely would need a lower-variance harness (pinned CPU, more
repeats, longer windows).
