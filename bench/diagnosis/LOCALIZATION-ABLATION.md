# Does the `file:line` change what an agent actually does?

Every other number in this suite measures what Reticle *emits*. This one measures what an agent *does
with it* — the question the whole source-pointer effort is a bet on, and the one that was still
unmeasured after that effort shipped.

## Method

Four regressions from `bench/harness/inject.mjs` were injected into `apps/bench-app`. For each, a
fresh general-purpose agent was given a user-visible bug report and told to find and fix it, under two
conditions differing in **one line of text**:

- **A — symptom only.** The bug report as a user would write it.
- **B — symptom + pointer.** The identical report, plus
  `The verification layer additionally reports the failing element's source location: <file>:<line>` —
  the exact artifact Reticle now emits on a failure.

Both conditions had the same repo, the same tools, and the same instructions. Agents were forbidden
from using `git` in any form (`diff`, `log`, `show`, `stash`, `checkout`), because the injected change
is visible in the working tree and would have handed over the answer. Correctness is the deterministic
oracle in `bench/fix-loop/verify.mjs` — the injected signature is gone — not the agent's own claim.
Tool-call counts are the harness's own `tool_uses`, not the agents' self-reports.

## Result (n = 3 paired)

| bug | A: symptom only | B: + `file:line` | change |
| --- | ---: | ---: | ---: |
| silent-dom-regression | 4 | 2 | −50% |
| signal-contract-violation | 13 | 4 | −69% |
| broken-form-validation | 6 | 3 | −50% |
| **total tool calls** | **23** | **9** | **−61%** |
| **fixed correctly** | **3 / 3** | **3 / 3** | no change |

Every agent in both conditions landed on the correct file and line.

## What this does and does not say

**It replicates the published shape, on this codebase.** The localization literature reports that
better fault localization leaves resolve rate roughly unchanged while cutting an agent's total work
(SHERLOC: +5.95pp resolve, −23.1% tokens; agents spend 18.5 turns, 48% of interaction, localizing
before their first patch). Here: fix rate identical, work down 61%. **The pointer does not make the
agent smarter. It removes the search.**

**It is a small result and should be quoted as one.**

- **n = 3, and the excluded cell is excluded for operator error — mine.** The fourth bug
  (`network-timeout`) satisfied the oracle in neither condition, and an earlier draft of this file
  guessed that its bug report was ambiguous. That was wrong, and the correction matters more than the
  guess did: **both** of its agents landed on the correct `Diagnostics.tsx:19`. They failed the oracle
  because the harness reverted the injections while they were still running and wiped their edits.
  Condition A on this bug ran for 17 minutes and crossed a revert AND a re-inject, so its 69 tool calls
  are inflated by re-searching a file that changed underneath it. Both cells are dropped together so
  the exclusion cannot favour a condition. The fix is to gate the revert on agent completion.

  Recorded because the direction is worth seeing even when the magnitude is not usable: **69 → 22 tool
  calls (−68%)** on the one bug in this set where localization was genuinely hard. That is the case the
  other three lack, and it is the case the literature is about.
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
