# Releasing

How versions are decided, cut, and announced. If you're contributing, the only part you need is [Changelog entries](#changelog-entries).

## Versioning

Every published `@reticlehq/*` package shares **one version, bumped in lockstep** — `core`, `browser`, and `server` speak the same wire contract, so a user pairing `browser@2.2.1` with `server@2.3.0` is a support question we don't want. One number means "these were tested together".

[SemVer](https://semver.org), where the public surface is: the MCP tool names and their input/output shapes, the wire contract in `@reticlehq/core`, the exported API of each package, the `reticle` CLI flags, and the on-disk flow/journal format.

- **patch** — bug fix, a new false-green class caught, docs, perf.
- **minor** — a new tool, a new predicate kind, a new adapter, a new CLI flag. Additive: existing calls behave identically.
- **major** — a tool renamed or removed, an output field removed, a wire message changed incompatibly, a saved flow that no longer replays. Ships with a [MIGRATION.md](MIGRATION.md) entry.

A deprecation gets one minor release of warning before removal in the next major.

## Cadence

- **Minor — roughly monthly**, when there's something worth shipping. Cut on a Tuesday, never on a Friday.
- **Patch — whenever a fix is ready.** No batching; a fix sitting in `main` helps nobody.
- **Major — rarely, announced ahead.** The tracking issue goes up at least two weeks before the tag, so users can object while it's still cheap.

The date is not the commitment; the shipped-and-green build is. A quiet month means a quiet month.

## Changelog entries

Any user-facing change adds its entry to the `[Unreleased]` section of [CHANGELOG.md](CHANGELOG.md) **in the same PR** — that's what makes cutting a release a 10-minute job instead of an archaeology session. Write it for someone who hits the bug, not for someone reading the diff: what was wrong, what it cost them, what it does now.

## Cutting a release

```bash
git switch main && git pull                     # 1. green main, nothing local

pnpm lint && pnpm typecheck && pnpm test:unit   # 2. the gates
pnpm test:e2e                                   #    required for every release, not just tool changes

pnpm version 2.3.0 --no-git-tag-version         # 3. bump root…
pnpm -r exec npm version 2.3.0 --no-git-tag-version   #    …and every workspace package, in lockstep
```

4. Move `[Unreleased]` in `CHANGELOG.md` under a `## [2.3.0] — YYYY-MM-DD` heading; leave a fresh empty `[Unreleased]`.
5. `git commit -m "chore(release): v2.3.0"` → PR → merge.
6. `git tag v2.3.0 && git push --tags`
7. **Publish a GitHub Release** on that tag, body = the changelog section. This is what triggers publishing — [`.github/workflows/publish.yml`](.github/workflows/publish.yml) runs the gates again and `pnpm -r publish`es in dependency order with npm provenance. It skips versions already on npm, so a partial run is safe to re-trigger.
8. `npm view @reticlehq/server version` to confirm, then post the release in Discord `#announcements` with the one-line "why you'd care".

If a release goes out broken: publish a patch. Never `npm unpublish` — installs in the wild break.

## Pre-releases

Risky or contract-touching work ships as `2.3.0-rc.1` on the `next` dist-tag first, announced in Discord for anyone willing to try it. Same process, `--tag next` on the publish.
