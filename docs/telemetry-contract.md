# The telemetry contract

> For anyone — human or agent — adding a tool, an event, a finding kind, or a failure path to Reticle.
>
> The rules here are enforced by `packages/server/src/telemetry/telemetry-contract.test.ts`. If you break one, that test tells you which and where. This page is why.

## Why this has its own contract

**Telemetry fails silently.** Nothing throws when an event is missed. No test goes red. No user complains. The data is simply, permanently absent — and you find out months later when someone asks a question the data cannot answer, about a period you can never re-collect.

That has already happened here twice, and both times the code looked correct:

- `daemon_stopped` was emitted fire-and-forget microseconds before `process.exit(0)`. The POST was killed every single time. The event **never once arrived**, and nothing anywhere indicated a problem.
- `bug_found` hand-copied the twelve contradiction kinds into a local `Set`. Correct on the day it was written; the thirteenth kind would have been silently miscounted, quietly deflating the one number we intend to publish.

So the rule is not "remember to add telemetry". The rule is that the guard lives in a test.

## The five rules

### 1. Everything routes through a chokepoint

Tool usage, timing, errors, verifications and bugs are all recorded in **one place** — `runTool` in `tools/invoke-tool.ts`. Adding a tool to `TOOLS` is all it takes to be instrumented.

Do **not** add telemetry inside a tool handler. If you find yourself wanting to, the metric probably belongs at the chokepoint, read off the result.

> The one exception is a path that genuinely does not go through `runTool` — currently only the verification runner (`reticle verify`, the HTTP verify surface), which has its own reporter in `telemetry/run-telemetry.ts`. **If you add a second dispatch path, it needs the same treatment**, and until it has one it is invisible. That gap existed for real: CI-found bugs were uncounted.

### 2. Names say what happened

`<noun>_<verbed>`, lowercase, no abbreviations: `verification_completed`, `bug_found`, `runtime_crashed`.

The old set failed this so badly it confused its own authors — `invoke` meant "the CLI ran" while `tool` meant "a tool was called", which is the opposite of how both read. A name that has to be looked up is a name that gets misread on a dashboard a year from now.

### 3. Names, never values

| Send                                 | Never send              |
| ------------------------------------ | ----------------------- |
| Parameter and flag **names**         | What they were set to   |
| Error **shape** (variables stripped) | The message             |
| **Our** stack frames                 | The user's stack frames |
| The **kind** of a defect             | What it was found in    |
| A hash of the git origin             | The origin              |

`--http-token` holds a secret. `reticle_act`'s `args` holds the text being typed into the app, which on a login form is a password. Assume every value is the worst thing it could be.

There is one narrow exception, and it is explicit rather than heuristic: parameters whose values are enums **we** defined are allow-listed in `telemetry/argument-shape.ts`, and anything unrecognised reports as `other` so a schema change cannot start forwarding free text.

### 4. Never derive a vocabulary by copying it

If a set of kinds already exists in `@reticlehq/core`, **import it**. Do not re-list it.

```ts
// ✗ correct today, wrong the moment core gains a member — and silent about it
const KINDS = new Set(['ui-advanced-request-failed', 'signal-contradicted' /* …10 more */]);

// ✓ cannot drift
const KINDS = new Set(Object.values(ContradictionKind));
```

A copied enum is a drift hazard anywhere. It is a **correctness** hazard when the thing that drifts is a number you publish.

### 5. A metric may never change behaviour

Every send is wrapped and best-effort. A telemetry failure must not fail a tool call, a verification, a daemon start, or `reticle init`.

The single exception is `daemon_stopped`, which is **awaited** — because the process exits immediately after and the send would otherwise be killed. Even then a failure resolves rather than throws.

## Adding things: what to do

| You are adding | Do this | Enforced by |
| --- | --- | --- |
| **A tool** | Add it to `TOOLS`. Nothing else. If its name implies a verdict (`assert`/`verify`), also add it to `VERIFICATION_TOOLS` | `telemetry-contract.test.ts` |
| **A verdict-producing tool** | `VERIFICATION_TOOLS` — otherwise it emits no `verification_completed` and stops counting toward the product's headline metric | ✓ |
| **A contradiction / anomaly kind** | Add it to core's enum only. `bug-found.ts` derives from it | ✓ |
| **A new finding shape** in a tool result | Teach `bugsInResult` the field. Add a case to the contract test | ✓ |
| **A failure path** (connect, install, crash) | Classify it into an enum with an explicit `OTHER` bucket — a classifier that cannot say "I don't know" lies instead | ✓ |
| **An event kind** | Add to `TelemetryEventKind` + a payload schema + emit it + add a live check to `apps/e2e/specs/telemetry-events-test.mjs` | partly — the live check is on you |
| **A dispatch path** that bypasses `runTool` | Give it a reporter like `run-telemetry.ts`, or it is invisible | ✗ **not enforced — be careful** |

## Verifying it actually works

Unit tests cannot see the failure mode that matters, because nothing throws. Two things do:

```bash
pnpm test:unit                                  # the contract test + the fingerprint/redaction guards
node apps/e2e/specs/telemetry-events-test.mjs   # fires every event at a real endpoint, checks it lands
```

The second is the one that matters. It drives the real built modules against a real capture server — real network, real process semantics, real redaction — and asserts each event **arrives**. Half its checks are leak checks, asserting that secrets, passwords, customer emails and home directories are _absent_.

**Both halves are mutation-tested.** Reintroducing the fire-and-forget bug fails 9 checks; disabling redaction fails 3. A guard that cannot fail is theatre, so these are periodically proven to bite.

## The privacy line, in one sentence

We measure **that** something happened and **what class** of thing it was — never **what** it was, in whose app, or containing what.
