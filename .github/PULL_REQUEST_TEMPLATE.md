<!-- Thanks for contributing to Reticle! Please fill this out so review is fast. -->

## What & why

<!-- What does this change, and why? Link the issue it closes. -->

Closes #

## How it was verified

<!-- How do you know it works? Tests added, manual repro, benchmark run, etc. -->

## Checklist

- [ ] Tests added/updated (RED → GREEN); the change is covered by a test that would fail without it
- [ ] `pnpm lint && pnpm typecheck && pnpm test:unit` all pass locally
- [ ] No `any`, no free strings (wire strings live in `@reticlehq/core`), no non-null `!`
- [ ] No `console.log` or internal tracking codes left in the diff
- [ ] Each changed file is under the 1000-line cap
- [ ] Docs and `CHANGELOG.md` updated if this is user-facing (entry under `[Unreleased]`)
- [ ] Security-affecting? Auth/redaction/trust-boundary changes keep the localhost-only, no-app-data-leaves-the-machine, no-arbitrary-JS posture (usage telemetry stays anonymous + opt-out per `docs/telemetry.md`) and are covered by a test
