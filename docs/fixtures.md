# Fixture apps

The apps in `apps/` are ours. We chose their defects, so passing against them says less than it looks like — and they are all wired to Reticle already, which makes them useless for the one question that matters before a release: **does the install still work on an app that has never seen Reticle?**

That question is answered in a separate repo: **[`reticle-fixtures`](https://github.com/reticlehq/reticle-fixtures)**.

## Why it is a separate repo

Three reasons, each of which bit us before the split:

- **They are somebody else's package managers.** `react-admin` is a yarn monorepo. Putting it under `apps/*` makes it a member of this pnpm workspace and breaks `pnpm install` for everyone.
- **They need a branch model this repo cannot give them.** A fresh install is only meaningful on a surface that has never been instrumented. Re-running `init` over an already-wired app reports `·` (already wired) for every step and proves nothing — which is exactly how an install regression ships unnoticed. `reticle-fixtures` keeps a pristine `clean` branch for that, plus `main` at the latest version and `reticle/<version>` per release.
- **They are large.** The upstream checkouts were eight gigabytes of somebody else's git history sitting gitignored inside this repo.

## What runs there

```bash
node scripts/materialise.mjs   # build apps/ from fixtures.json at pinned refs
node scripts/verify.mjs        # install into every clean app, boot it, assert a session connects
```

The last step is the one that earns its keep. Every install bug found so far has been silent: the app boots, the `init` report reads clean, and nothing connects. Next.js shipped in that state through a whole release — three independent defects, none visible to any check short of opening a browser and looking at `reticle status`.

## What stays here

`apps/` — bench-app, next-smoke, the Remix and Astro examples, the Electron and Tauri smoke apps, atlas, and the API. These are the CI gates (`pnpm test:e2e`, `pnpm test:e2e:desktop`), and `integration-coverage.test.ts` fails if one of them goes missing while `SKILL.md` still offers its framework.

The split is: **`apps/` proves the tools work. `reticle-fixtures` proves the install works.**
