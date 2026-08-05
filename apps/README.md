# `apps/` — what belongs here, and what does not

This directory grew without a rule, so things arrived for a reason and nothing recorded whether that reason was still being served. The result was three empty directories, two apps duplicating wiring the smoke apps already prove, and the hardest fixture in the repo run by nothing at all.

The rule is one sentence:

> **Every app here exists to answer a question a gate asks. If no gate asks it, the app does not belong here.**

Enforced by `packages/server/src/tools/integration-coverage.test.ts`, which fails when a shipped integration has no covering app and spec. It is a red build, not a convention.

## The three jobs — and nothing else

| Job | What it is | Size rule | Examples |
| --- | --- | --- | --- |
| **Integration proof** | One app per framework we publicly offer, proving the wiring works end to end | **Thin is CORRECT.** `electron-smoke` is 290 lines because its job is "the wiring works", not to be an app | `next-smoke`, `electron-smoke`, `tauri-smoke` |
| **Benchmark target** | A stable, measurable app for token/perf numbers | Whatever the measurement needs; keep it boring so numbers stay comparable | `bench-app`, `large-dom-bench` |
| **Adversarial fixture** | Built to be hard, to find what Reticle cannot see | Big, realistic, emergent defects. **One is enough** | `atlas` |
| **Support infrastructure** | Not apps under test: the backend the specs drive, and the runner itself | Whatever the battery needs | `api`, `e2e` |
| **Product demo** | Shows Reticle rather than testing it — carries its own benchmark and repair loop | Whatever the story needs | `vibe-builder-demo` |

**Every directory here states its job in the first line of its own README.** If you add one and it has no README, the next person cannot tell what it is for — which is exactly how this directory got confusing.

## Rules

1. **A new app needs a gate in the same change.** Not "later" — the spec is what makes it an asset rather than decoration.
2. **One app per framework we publicly offer.** The list of frameworks lives in `SKILL.md`, which is what users actually paste. If the skill offers it, there is an app and a spec for it.
3. **Thin integration apps are correct.** Do not grow them. A 290-line app that proves Electron wiring works is doing its whole job.
4. **Defects in the adversarial fixture are not planted to match our detectors.** See `atlas/README.md` — an app whose only bug is "this handler throws" will always be caught by "did a request fail", and catching it demonstrates nothing.
5. **A long-running app must not join the shared battery casually.** Every spec shares the bridge on `:4400`. Atlas streams SSE, and running it battery-wide floods every other spec's session — it turned five green specs red. Specs that need a noisy app spawn and kill it themselves, the way the desktop specs do.
6. **Vanilla (non-React) coverage is load-bearing.** `large-dom-bench` is plain TS on purpose. Folding it into a React app would delete the proof that the SDK works without React.

## Coverage today

Driven by what `SKILL.md` offers a user, which is the promise that must not break:

| Framework offered to users | App               | Gate          |
| -------------------------- | ----------------- | ------------- |
| Vite + React               | `bench-app`       | ✅ e2e        |
| Next.js                    | `next-smoke`      | ✅ e2e        |
| Electron                   | `electron-smoke`  | ✅ desktop    |
| Tauri                      | `tauri-smoke`     | ✅ desktop    |
| Plain HTML / vanilla       | `large-dom-bench` | ⚠️ bench only |
| (Adversarial fixture)      | `atlas`           | ✅ e2e        |
| Remix                      | `examples/remix`  | ❌ **none**   |
| Vite + Vue                 | ❌ **none**       | ❌ **none**   |
| Vite + Svelte              | ❌ **none**       | ❌ **none**   |
| SvelteKit                  | ❌ **none**       | ❌ **none**   |

The last four are the honest gap: the public skill offers them and nothing proves them. They are listed here rather than quietly omitted, because an unproven promise is the thing this directory exists to prevent.

`examples/astro` is the inverse — an app for a framework the skill never offers. Kept because it is the only Astro coverage and it wires the SDK differently (Astro SSRs its own HTML, so the plugin's `index.html` injection never fires), which is worth keeping honest if Astro is ever offered.
