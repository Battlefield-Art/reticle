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

## Result (2026-07-21, 8s × 3 repeats, headless Chromium)

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
