# Complex app fixtures

Real, production-grade applications that Reticle is tested and benchmarked against. The apps in `apps/` are ours — we chose their defects, so passing against them says less than it looks like. These are somebody else's code, at real scale, and they are where a false green actually costs something.

## Why here and not in `apps/`

`pnpm-workspace.yaml` globs `apps/*`, so anything placed there becomes a workspace member. Two of these bring their own package manager and their own workspaces — react-admin is a **yarn** monorepo — and installing one under `apps/` breaks `pnpm install` for the whole repo. They are also multi-gigabyte checkouts with their own git history.

So: the fixtures live here, the **contents are gitignored**, and `README.md` + `setup.sh` are committed. The recipe is versioned; the gigabytes are not.

## The fixtures

| Directory | What it is | State |
| --- | --- | --- |
| `react-admin-src/` | Upstream `marmelab/react-admin`. Use `examples/demo` (Posters Galore) — a real admin console, 400+ node dashboard. Wired to this repo by **Vite alias**, never `yarn add`. | Working |
| `electron-app-react-admin/` | A real Electron main process wrapping that renderer, with an IPC layer carrying the shapes that actually break on desktop. | Working |
| `tauri-app-react-admin/` | A Tauri v2 shell over the same renderer. Builds and connects; commands hang on this app specifically. | Parked |
| `next-app-playground/` | Vercel's App Router playground — parallel routes, cached segments, view transitions, server actions. Where the stale-ref false green was found. | Working |
| `razorpay-blade-reticle/` | A production merchant dashboard on the Blade design system, with its own bench harness. Five execution-proven false greens came from here. | Has locally-swapped `@reticlehq/*` dist — re-alias before trusting a run |

## Rules learned the hard way

**Wire the SDK by ALIAS, never by installing tarballs into the app.** Repeated `npm install --no-save @reticlehq/*.tgz` pruned MUI's transitive dependencies out of one fixture and pulled a _published_ `@reticlehq/core` alongside a local plugin in another — the app then failed in ways that looked like Reticle bugs and were not. Aliasing touches nothing the package manager owns.

**Clear the Electron profile between runs** (`~/Library/Application Support/<app-name>`). A cached service worker survives every file-level revert, including `git checkout`, and makes the app serve a stale page while looking healthy.

**Poll, never sample once.** The react-admin demo has an upstream render loop and renders roughly two runs in three. Any conclusion drawn from a single run against it is worthless.

**A/B against `NO_RETICLE=1`** (wired into the demo's vite config) before blaming Reticle for anything the app does. That check is what showed the render loop is upstream, not ours.

## Seeded defects

The Electron fixture carries deliberate, realistic IPC defects — a batch that resolves `ok` while individual items failed inside the payload, a settings write that silently drops a field, and a fire-and-forget send with no verdict. They are written the way a team under deadline writes them, not shaped to match a detector.
