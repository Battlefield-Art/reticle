# Does the `file:line` change what an agent actually does?

Every other number in this suite measures what Reticle *emits*. This one measures what an agent *does
with it* — the question the whole source-pointer effort is a bet on, and the one that was still
unmeasured after that effort shipped.

## Method

Four regressions from `bench/harness/inject.mjs` were injected into `apps/bench-app`. For each, a
fresh general-purpose agent was given a user-visible bug report and told to find and fix it, under two
conditions differing in **one line of text**:

- **A — symptom only.** The bug report as a user would write it.
- **B — symptom + pointer.** The identical report, plus the source location — and specifically the
  location Reticle **actually emits**, which is where the acted ELEMENT is rendered, not where the bug
  is caused. Those are the same file for two of these bugs and different for the third, and getting
  that distinction wrong is the single easiest way to inflate this experiment (see below).

Both conditions had the same repo, the same tools, and the same instructions. Agents were forbidden
from using `git` in any form (`diff`, `log`, `show`, `stash`, `checkout`), because the injected change
is visible in the working tree and would have handed over the answer. Correctness is the deterministic
oracle in `bench/fix-loop/verify.mjs` — the injected signature is gone — not the agent's own claim.
Tool-call counts are the harness's own `tool_uses`, not the agents' self-reports.

## Result (n = 3 paired)

| bug | A: symptom only | B: + `file:line` | change | element file = cause file? |
| --- | ---: | ---: | ---: | --- |
| silent-dom-regression | 4 | 2 | −50% | yes |
| signal-contract-violation | 13 | 6 | −54% | **no** — element in a view, cause in the store |
| broken-form-validation | 6 | 3 | −50% | yes |
| **total tool calls** | **23** | **11** | **−52%** | |
| **fixed correctly** | **3 / 3** | **3 / 3** | no change | |

Every agent in both conditions landed on the correct file and line.

### The correction that produced these numbers

An earlier run of this table reported **−61%**, because condition B for `signal-contract-violation` was
handed `store.ts:99` — the line that actually needed changing. **Reticle cannot produce that.** It
reports where the acted control is rendered (`Deployments.tsx:74`); the cause is a store method one hop
away. Giving the agent the fix site measured a tool we do not have.

Re-run with the pointer Reticle genuinely emits: **6 tool calls instead of 4**, and the agent still
traced correctly from the control to the store. The honest total is **−52%**, not −61%.

**This is a real property of the artifact, not a benchmarking detail.** For a bug whose symptom and
cause live in the same component, the pointer lands on the fix. For a signal, state or network bug,
it lands on the control that should have produced the effect — a starting point, not the answer, and
the agent still pays one hop. The measurement above includes that hop, which is why one of the three
cells improves less than the others.

## What this does and does not say

**It replicates the published shape, on this codebase.** The localization literature reports that
better fault localization leaves resolve rate roughly unchanged while cutting an agent's total work
(SHERLOC: +5.95pp resolve, −23.1% tokens; agents spend 18.5 turns, 48% of interaction, localizing
before their first patch). Here: fix rate identical, work down 61%. **The pointer does not make the
agent smarter. It removes the search.**

**It is a small result and should be quoted as one.**

- **n = 3, and the fourth cell was never valid — I found out by re-running it.** This file has now
  given two wrong explanations for that exclusion, and the third is the real one, so the sequence is
  worth keeping as a caution about guessing at causes:

  1. First draft: "the bug report was ambiguous." A guess.
  2. Second draft: "operator error — I reverted while its agents ran." True, but not the cause.
  3. Actual cause, found by re-running it cleanly: **`network-timeout` is not a regression.** Its
     injection ADDS a fault-trigger button to `Diagnostics.tsx`; the oracle is satisfied when that
     line is REMOVED. My bug report told the agent the timeout trigger had stopped working — the exact
     opposite of what the injection does. **No agent could have passed that cell.**

  The clean re-run makes it unmistakable: condition A spent 44 tool calls and condition B 23, and
  *both* edited `reticle-dev.ts` — a different file from the one condition B was explicitly told to
  open. Agents given a wrong problem statement do not find the right answer faster; they find a
  different wrong answer faster. The cell is dropped for being invalid, not for being unlucky, and the
  −68% direction reported in an earlier draft is **withdrawn**: it was measuring nothing.

  This is also the one place in the suite where a bug report was authored by hand rather than derived
  from the injection, which is exactly where this class of error gets in. A bug report should be
  generated from what `apply()` does, not written from memory of what it was supposed to do.

- **One run per cell.** No repeats, so per-bug numbers carry run-to-run variance that is not measured.
- **The fixture flatters condition A.** `apps/bench-app` is a small app where a symptom description
  greps to the right file in 4 tool calls. On a codebase where localization is genuinely hard — the
  case the literature measures and the case this layer exists for — the baseline is far higher and the
  gap should widen. This measurement therefore **understates** the effect it finds.
- **Fix rate did not move**, and no one should claim it did. At this scale every agent found every bug
  eventually; the pointer bought the path, not the outcome.

## Why this was worth running rather than asserting

The three prior measurements established that the pointer is *present* (83/85), that its presence is
*caused by the stamp* (control: 0/22), and that it is *unrecoverable by any other Reticle route*
(0/5). All three describe the artifact. None of them showed that an agent behaves differently when it
has one — which is the only reason any of it matters.
