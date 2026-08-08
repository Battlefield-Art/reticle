# Contributing to Reticle

Thanks for your interest in Reticle! Reticle is the **proof layer for AI agents** — it verifies a running web app from the inside, without screenshots. It instruments the DOM, network, routing, console, and framework state in your app, and exposes that to an agent over MCP as a `look → act → observe → assert` loop.

This guide covers how to set up the repo, the rules we hold the line on, and how to land a change. We aim to make contributing pleasant — if anything here is unclear, ask in [Discord](https://discord.gg/7kS66x494) or open an issue.

**Looking for something to work on?** [`good first issue`](https://github.com/reticlehq/reticle/labels/good%20first%20issue) is scoped, reviewed, and has a pointer to the file to start in. [`help wanted`](https://github.com/reticlehq/reticle/labels/help%20wanted) is bigger and unclaimed. Comment on the issue to claim it — we'll answer within a day or two, and nobody else will start on it once you have.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Prerequisites

- **Node.js `>=22.12`** (see `engines` in the root `package.json`).
- **pnpm `10.x`** — the repo pins `pnpm@10.33.2` via `packageManager`. The easiest way to get the right version is [Corepack](https://nodejs.org/api/corepack.html):

  ```bash
  corepack enable
  ```

This is a single git repo — a **pnpm + [turbo](https://turbo.build/) monorepo**. Install everything from the root:

```bash
pnpm install
```

---

## Repository layout

```
packages/core          @reticlehq/core         — wire contract, constants, zod schemas (deps: zod)
packages/browser       @reticlehq/browser      — instrumentation SDK embedded in the app (DOM-side)
packages/server        @reticlehq/server       — bridge + MCP server, the `reticle` CLI (Node-side)
packages/react         @reticlehq/react        — React adapter: DOM ref -> component -> source file
packages/vite-plugin   @reticlehq/vite-plugin  — Vite integration: stamps source + auto-injects connect()
packages/babel-plugin  @reticlehq/babel-plugin — stamps data-reticle-source (source mapping, React 19)
packages/next          @reticlehq/next         — Next.js source mapping (keeps SWC) via withReticle (CJS)
packages/test          @reticlehq/test         — spec runner + matchers for CI (peer vitest)
packages/eslint-plugin @reticlehq/eslint-plugin — dev-only lint rule: state changed ⇒ signal fired
apps/bench-app         @reticlehq/bench-app    — Vite/React dashboard used to dogfood Reticle
apps/api               @reticlehq/api          — Express backend exercising real-world behaviors
apps/next-smoke        @reticlehq/next-smoke   — Next.js 15 app verifying Reticle on Next
docs/                  — user-facing docs (getting-started, usage, token-efficiency, local-registry)
SKILL.md              — public skill for users integrating Reticle into their own project (the canonical paste-URL)
```

The TypeScript library packages (`-core`, `-browser`, `-server`, `-react`) are **strict TypeScript** and are the focus of the build/lint/test gates. `@reticlehq/babel-plugin` / `@reticlehq/next` are plain CJS tooling, and `apps/api` / `apps/next-smoke` are local fixtures — these are excluded from the gates.

### Service boundaries (who owns what)

- **`@reticlehq/core` is the contract.** Any message that crosses browser ↔ bridge ↔ agent is defined there as a constant + zod schema. It sits at the bottom of the graph (deps: `zod` only); everything depends on it, it depends on nothing. Never inline a wire string in `browser` or `server` — add it to `core`.
- **`@reticlehq/browser` only touches the DOM/page.** It never imports Node APIs.
- **`@reticlehq/server` only runs in Node.** It never imports DOM APIs.
- **`@reticlehq/react` is optional enrichment.** Core must work without it.

---

## Build, lint, typecheck, test

All gates run from the repo root and fan out across packages via turbo:

```bash
pnpm build       # turbo run build
pnpm lint        # turbo run lint
pnpm typecheck   # turbo run typecheck
pnpm test:unit   # turbo run test:unit   (pnpm test is an alias)
```

Before you push, the full local gate is:

```bash
pnpm lint && pnpm typecheck && pnpm test:unit
```

Other useful scripts: `pnpm format` / `pnpm format:check` (Prettier), and `pnpm bench` (the benchmark harness — see [`bench/SCORECARD.md`](bench/SCORECARD.md)).

---

## Test-driven development

We write tests first: **RED → GREEN → REFACTOR.**

1. **RED** — write a failing test that pins the behavior you want.
2. **GREEN** — write the minimum code to make it pass.
3. **REFACTOR** — clean up with the test green; check the file is still cohesive and under the 1000-line cap.

Every behavior change ships with a test. Bug fixes start with a test that reproduces the bug.

---

## Coding rules (non-negotiable)

These are enforced by lint and review. A PR that violates them will be asked to change.

1. **Equality:** `===` / `!==` always. `eqeqeq` is an error.
2. **No `any`.** Use `unknown` + zod narrowing at boundaries. `no-explicit-any` is an error.
3. **No free strings.** Every domain / wire / UI string is a named constant. Wire strings live in `@reticlehq/core`, never inlined in `browser` or `server`.
4. **No non-null `!`.** Use optional chaining + explicit null checks.
5. **Tests first** (see above).
6. **1000-line file cap.** Over it = a cohesion failure; split before adding. (Raised from 600, which was forcing splits of genuinely cohesive units and turning two-line fixes into refactors. Cohesion is the rule; the number is the backstop.)
7. **Inject the clock.** Never call `Date.now()` / `Math.random()` inside pure logic — pass them in.
8. **Scope every data access to the authenticated principal.**
9. **Design tokens are the only place design values live.**
10. **No internal tracking tags.** Comments, file names, directory names, and test descriptions must never contain design-doc reference codes or internal version strings.
11. **No `console.log`** left in committed code.
12. **Lossy transforms declare their loss.** Any transform that can drop, truncate, or shape-coerce data on a path an agent reads must report that it did, in a machine-readable way the consumer can detect. The consumer is an agent deciding whether a green verdict is trustworthy, so a partial answer it cannot tell apart from a complete one is a false green — and a note in a log, or a value quietly shortened with nothing to say so, is not a report. `sanitizeWithReport` is the reference: it returns the value **and** a `TruncationReport`, precisely so a caller cannot mistake a fraction for the whole.

    The read path is registered in [`scripts/check-lossy-transforms.mjs`](scripts/check-lossy-transforms.mjs), which runs in `pnpm lint`. **Adding an export to one of those modules fails the build until you classify it** — `report` (a field beside the value), `marker` (an unambiguous in-band sentinel, where the value's shape has to survive), `signal` (announced on the event stream or a health surface), `none` (not lossy), or `silent` (a known gap, with the reason written down). Anything classified lossy must also be named in a conformance suite that drives a fixture guaranteed to lose data and asserts the loss is declared.

    Honest about its own limits: the guard catches a new **export**, not a new behaviour. Someone can still add silent truncation inside a function already on the list. What it prevents is the case that actually happened three times — a transform written in isolation by someone who did not know the rule existed. Prove the guard still works with `node scripts/check-lossy-transforms.mjs --self-test`.

### Naming conventions

| Thing | Convention | Example |
| --- | --- | --- |
| Package | `@reticlehq/<kebab>` | `@reticlehq/browser` |
| File | kebab-case | `ring-buffer.ts` |
| Type / class | PascalCase | `RingBuffer`, `ReticleEvent` |
| Variable / function | camelCase | `pushEvent` |
| Constant object | PascalCase + `as const` | `EventType`, `ActionType` |
| React component file | PascalCase or `create-` prefix for creation flows | `App.tsx`, `create-session-view.tsx` |
| `useX` function | ONLY if it calls React hooks | else use `apply/build/get/handle` |

---

## Running the demo app locally

`apps/bench-app` is the React dashboard we use to dogfood Reticle (tabs, lists, modals, forms, API calls).

```bash
pnpm install                 # once, from the repo root
pnpm --filter @reticlehq/bench-app dev   # http://localhost:4312
```

From there, point your MCP-capable agent at Reticle and ask it to verify the app — see [`docs/getting-started.md`](docs/getting-started.md) for the full walkthrough.

---

## Commit and pull-request flow

1. **Branch off `main`.** Use a short, descriptive branch name.
2. **Write tests first** for the behavior you're adding or fixing.
3. **Use [Conventional Commits](https://www.conventionalcommits.org/)** for commit messages, e.g. `feat(server): add reticle_viewport tool`, `fix(browser): restore patched fetch on teardown`, `docs: clarify install steps`. Common scopes mirror the packages: `protocol`, `browser`, `server`, `react`, plus `docs` / `chore`.
4. **Keep the gates green:** `pnpm lint && pnpm typecheck && pnpm test:unit`.
5. **Update docs and `CHANGELOG.md`** when the change is user-facing. New entries go under the `[Unreleased]` section, following [Keep a Changelog](https://keepachangelog.com/).
6. **Open a PR against `main`** and **link the issue** it resolves (e.g. `Closes #123`). Fill out the PR template checklist.

For anything non-trivial, **open an issue first** so we can agree on the approach before you invest time in a PR.

---

## License of contributions

Reticle uses a per-package license model (Apache-2.0 for the embeddable SDK packages, FSL-1.1-ALv2 for the server / CLI / umbrella, and the Reticle Enterprise License for `packages/server/src/ee/`). By contributing, you agree that your contribution is licensed under the license of the package(s) you're modifying. See the root [LICENSE](LICENSE) and each package's own `LICENSE` file.
