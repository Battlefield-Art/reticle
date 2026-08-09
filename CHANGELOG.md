# Changelog

All notable changes to the **`@reticlehq/*`** packages are documented here (each entry notes the package it affects). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] — 2026-08-09

**One tool surface, an MCP server that stays up, and a long list of answers that were wrong.** Most
of what follows was found by driving the shipped surface against live applications and reading what
came back — a 48-tool fuzz with hostile arguments, a nine-app fixture fleet under a new trace, and
four brute-force stress specs against the transports. Every number quoted here was measured.

### BREAKING — read before upgrading

- **`RETICLE_TOOL_PROFILE` is retired. There is one tool surface.** Nothing to choose, nothing to
  tune. Every value the variable ever took still resolves — `full` selects the full surface, and
  `core` / `standard` / `hybrid` / `dynamic` all select the default — and the daemon reports that the
  setting retired rather than reusing the "did not take effect" message, which blamed the daemon's
  environment and sent people to check something that was fine. "Unset" and "set to `0`" are also
  distinct messages now, because only one of them means you did not ask.

  The four retired profiles each died for a measured reason. Off the real wire, with a fresh daemon
  per reading: `dynamic` 2 tools / 1,543 B / ~386 tok per turn, `core` 16 / 18,183 B / ~4,546,
  `hybrid` 16 / 18,183 B / ~4,546 (byte-identical to `core`), `standard` 33 / 32,234 B / ~8,059,
  `full` 48 / 127,903 B / ~31,976. `standard` charged ~3,500 tokens every turn for reach `reticle_run`
  already gave; `dynamic` was selected by nothing and is contradicted by this repo's own accuracy
  measurement.

  **The replacement for `full` is `RETICLE_ADVERTISE_ALL_TOOLS=1`** (plus a daemon restart). It is the
  only mode that advertises `outputSchema`, which is what makes the MCP layer validate tool OUTPUT —
  a verification switch for suites that call by name, not a mode to run agents in. It cannot be the
  default: carrying output schemas on the 16-tool surface measures 18,183 → 41,117 bytes, 2.26x,
  +5,733 tokens per turn.
- **`@reticlehq/browser` — `reticle_act { action: 'select' }` now REFUSES a value matching no
  `<option>`.** It used to assign the value deliberately, let the browser reject it, and report the
  resulting `valueChanged` delta as proof the option never took. That reasoning only holds if nobody
  is listening. An unmatched value drives `selectedIndex` to `-1`, so `el.value` becomes `''` — and
  the `change` event still fired, so a reporting app read that empty value in its own handler and
  PERSISTED it, corrupting a stored setting. Reticle caused the defect it exists to catch. The
  refusal now lists the option values that do exist, with their labels in brackets. **If you relied
  on the old "detectable no-op", the call now throws.**
- **Six parameters that advertised a vocabulary now enforce it, at the schema.** `reticle_query.by`
  and `reticle_scroll_to.by` reject an unsupported strategy, `reticle_console.level` and
  `reticle_session.level` reject an unknown level, and `reticle_act.action` /
  `reticle_act_and_wait.action` reject an unknown action. Each of these previously answered a
  wrong-vocabulary call with a plausible, silent, wrong answer — see the honesty section below. Both
  the schemas and the prose now derive from the enums in `@reticlehq/core`, so they cannot drift
  apart again.
- **`@reticlehq/server` — `reticle_state` no longer returns React effect-hook entries.** They are
  disclosed as dropped via the existing `truncation` report, and only when something was actually
  dropped, so an intact read is byte-identical to before and the note's presence IS the warning.
  Nothing in an effect entry was assertable: `create`/`destroy` arrive `null` because functions do
  not survive serialization, `deps` restates values the value hooks already carry, and `next`
  re-chains the whole effect list into every entry.
- **`@reticlehq/server` — `reticle open` reports `connected: true | false` instead of an
  unconditional `opened`.** It also reports a launcher failure when there is one, and points at
  `reticle doctor` when nothing turns up. Sessions are counted against the pre-launch count, so
  opening a second app while one is connected is not reported as an instant success.
- **`@reticlehq/server` — `act_and_wait` with an `element` or `text` consequence that was ALREADY
  TRUE before the act now answers `verified: "unknown"`, not `"yes"`.** Measured on a Next
  app-router fixture: `until: { kind: 'text', contains: 'Parallel Routes' }` returned `verified:
  "yes"` at 478ms with `routeChanges: 0`, while the real route change landed 1.8s later — the
  predicate matched a nav link that was on the page before the click. DOM-state predicates are now
  evaluated BEFORE the act. Deliberately `unknown` and not `no`: the app may be fine. A real failure
  still outranks it. Event-based predicates are unaffected and pay nothing.
- **`@reticlehq/server` — a detected contradiction now outranks an already-true assertion.** Both
  hold at once whenever an agent asserts something already on screen while the write fails
  (`{ text: 'Saved' }` over a 500). The already-true clause used to win, so a DETECTED false green was
  downgraded from `no` to `unknown` and the agent was told to rewrite its assertion instead of being
  told the app is broken. **Some verdicts that were `unknown` are now `no`.**
- **`@reticlehq/server` — `reticle_act_and_wait { args: { native: true } }` is refused instead of
  silently ignored.** `args` is a record, so the flag was accepted and then reached nothing: the
  agent asked for the one thing a synthetic click cannot do (a file picker, the clipboard, an
  `isTrusted`-gated handler), got a synthetic click, and read a result that looked like success. The
  refusal names the route that works — `reticle_act { args: { native: true } }`, then assert with the
  `since` cursor it returns.
- **`@reticlehq/server` — a zero-step flow is refused rather than saved.** `flow_save` returned
  `{ stepCount: 0, grade: "assertion-free" }` with no error, `flow_list` then showed one more flow,
  and `flow_verify` called it `unverifiable` forever: the agent believed it had saved a regression
  test and had written a permanent suite entry that can never go green or red.
- **`@reticlehq/server` — `isError` is now set on every refusal, not only on a thrown handler.**
  Every tool that RETURNS a well-formed `{ error, recovery }` — the flow tools, `annotate`, `project`,
  `run_export`, both visual tools, `viewport`, `network_mock`, `navigate` with a missing url, and
  `feedback` itself — came back as protocol SUCCESS with the flag unset. **Anything branching on
  `isError` will now see refusals it did not see before.** Top-level `error` only: the key also
  appears inside console entries and network rows as ordinary data.
- **`@reticlehq/server` — `reticle_feedback` no longer blocks on the network, and `sent` means
  something narrower.** The call awaited a real POST — ~340ms measured across the fleet, mid-task. On
  the agent path `sent` is now false and **`accepted` (validated, redacted, queued) is the field that
  carries the promise**; `sent` still means CONFIRMED DELIVERY. A background send that fails reaches
  the reporter on its next tool result. `reticle feedback` typed by a human still waits for the real
  answer.
- **`@reticlehq/test` — a suite where every spec skipped no longer reports `ok: true`.** `ok` was
  `0 === failed`, so a run in which nothing ran at all — no browser, no real input, every spec
  skipped — was indistinguishable from one where everything passed, and **a CI script gating on
  `summary.ok` went green having verified nothing.** `ok` now also requires that something ran. An
  EMPTY suite stays `ok`: having recorded no flows is a different statement from having recorded
  flows and running none of them.
- **`@reticlehq/core` — the `present` state flag is no longer emitted in TOON snapshots.** It was
  seeded onto every element, so it was true of everything and carried no information — 4,000
  characters of nothing on a 500-element snapshot, in the layer whose entire purpose is cutting the
  token bill. `btn e0 "Item 0" [vis,present,en]` is now `btn e0 "Item 0" [vis,en]`. **If you parse
  snapshot flags, `present` is gone.**

### Fixed — correctness and honesty

- **`@reticlehq/server` / `@reticlehq/browser` — `reticle_query` answered "0 matches" for an
  unsupported strategy instead of refusing.** Measured against a live page that visibly had all of
  these: `by:'css' value:'body'` → `{ count: 0 }`, `value:'input'` → `{ count: 0 }`, `value:'*'` →
  `{ count: 0 }`. Zero is the most dangerous answer this product can give — indistinguishable from
  "the element is genuinely not there", so an agent asking "is the error banner up?" is told no and
  reports the app is fine. `css` is the first thing anyone arriving from Playwright or Testing
  Library types. Three causes, each fixed at its own layer: the schema now rejects it, the browser's
  strategy switch throws and names the strategies that work instead of `default: return []`, and
  `matchQuery` no longer wraps candidate-finding in `catch { elements = [] }` — which turned ANY
  exception into "no matches" (the whole 168-test DOM suite is green without it, so nothing was
  relying on the swallow).
- **`@reticlehq/server` — `reticle_scroll_to` had the same false negative.** An unsupported strategy
  scrolled the whole list and reported the row is not in it.
- **`@reticlehq/server` — `reticle_console` could not tell a quiet page from a broken filter or a
  dead observer.** `level: 'ERROR'` matched nothing, because the filter builds `console.${level}`; on
  a page WITH logs the zero-match hint rescued it, but on a quiet page the answer was byte-identical
  to a genuine all-clear — and "no console errors" is the claim agents lean on hardest. An empty
  console read now carries `observed: true` and says the look ran and found none.
- **`@reticlehq/react` / `@reticlehq/browser` — `reticle_state` read the previous commit's hooks,
  every other commit.** Reported twice, with a measured repro: after click 1 the DOM says 1 and the
  hooks say `[0]`; after click 2, DOM 2 and hooks `[2]`; after click 3, DOM 3 and hooks `[2]`. React
  keeps two fibers per element and swaps which is committed on every commit, while the
  `__reactFiber$…` key on the DOM node keeps pointing at the fiber created at MOUNT. Fixed inside
  `getFiber()`, so `identify`, `readState` and `hasHoverHandlers` are all fixed at once, and the
  zero-install CDP reader — which carried an identical copy of the defect nobody had reported yet —
  got the same check. An unrecognized fiber shape returns unchanged, so an unseen React version
  degrades instead of throwing.
- **`@reticlehq/server` — 22 retired tool names answered "unknown tool" for capabilities that
  exist.** Confirmed live: `reticle_run { tool: "reticle_record_start" }` → unknown tool, and the same
  for `reticle_diff`, `reticle_yield`, `reticle_flow_load`, `reticle_lease_acquire` and 17 more —
  exactly what an agent trained on an earlier release, or reading the merged tool's own description,
  reaches for. They now redirect by name (`reticle_record_start was merged into reticle_record. Call
  reticle_record { action: "start", … }`), derived from the merge and retirement tables rather than
  hand-written, on both the by-name and `reticle_run` paths.
- **`@reticlehq/server` — calling a non-advertised tool BY NAME looked like the tool did not exist.**
  The default surface advertises 16 of 46; the rest stay callable through `reticle_run`. A by-name
  call got the SDK's bare `Tool <name> not found`, so one field sweep scored 25 failures that were
  nothing of the kind — every one of them worked through `reticle_run` seconds later. A name Reticle
  owns is never answered with "not found".
- **`@reticlehq/server` — `reticle_run` answered every failure with "fix the arguments".** It caught
  every error and returned its own shape with `hint: "fix the arguments and call reticle_run again"`,
  so under the default surface — where most of the tool surface is reached through `reticle_run` —
  recovery was silenced for nearly every tool. A stale ref, a paused session, a missing pairing token
  and a destructive-action block all came back as the agent's arguments being wrong. They were not,
  and wrong advice spends the retry it was meant to save.
- **`@reticlehq/server` — a caller's typo could bill them 25k tokens and get blamed on Reticle.**
  Fuzzing all 48 tools with hostile arguments found `reticle_screenshot { name: <100KB> }` returning
  a **100,392-byte** tool result and `reticle_inspect { ref: <100KB> }` returning 4,458 — both echoing
  the argument back verbatim and then saying the error "may be a defect in Reticle". After: 4,657 and
  703 bytes, each with the right recovery. The cap sits in `buildErrorPayload`, the single funnel
  every tool error crosses, and elides the MIDDLE — the recovery table matches substrings at the END,
  so head-truncation would sever exactly the part that makes an error recognizable.
- **`@reticlehq/server` — `act_and_wait` on a paused session answered with no verdict at all.**
  `verified` is the one field an agent reads off this tool, and the pause short-circuit returned a
  bare `{ paused, guidance, hint }` — not yes, not no, not unknown: undefined, from a call carrying
  no error that looked like it had succeeded. Reported from the field on two apps. A pause is the
  textbook UNKNOWN, and it must never read as `no`, which would report a human's own pause as the app
  failing.
- **`@reticlehq/server` — every `act_sequence` step compiled to a volatile ref, so every saved flow
  drifted.** Measured in a field sweep across five apps: drift 7/7, verify fail 7/7, heal unhealable
  7/7. Three defects stacked. The sequence compiler understood only the testid, while the act
  compiler had long since learned role+name and component/source; the sequence took `subs[0].anchor`
  unconditionally, so a first sub-step without a testid degraded the whole sequence to the
  "no anchor" sentinel; and replay then queried that sentinel as if it were a locator, asked the DOM
  eight times for a testid literally named `unresolved`, and offered a rebind candidate that
  `flow_heal` rightly refused on confidence (0.13 < 0.5) — the reported contradiction between two
  tools. `replayFlow` also had no `act_sequence` branch at all, so a saved sequence ran ONE act with
  `action: ''` and sub-steps 2..n never executed; fixing the first two alone would have turned a
  visible drift into a silent partial replay reporting `ok`.
- **`@reticlehq/server` — `reticle_annotate` implements `assert-net`, which the docs had been
  promising.** The cheat-sheet told agents to attach `assert-signal`/`assert-net` when a flow graded
  below `asserted`. There was no `assert-net`: the call returned `annotate_unknown_kind`, the
  annotation was dropped, and the flow stayed presence-only — a flow that CAN pass while broken.
  Everything underneath already existed, including the `count` cardinality check that is the
  double-submit oracle, so this makes a documented sentence true rather than adding a feature. A new
  gate fails when any agent-facing doc names a `reticle_*` that is neither a tool nor an emitted
  event.
- **`@reticlehq/server` — `annotate` and `record { action: "stop" }` targeted the literal name
  `default` rather than the recording that is running.** Reported three times: start `"my-flow"`,
  act into it, annotate → `annotate_no_step`, and the agent's rational response to "no steps" is to
  record MORE into the same empty recording. A `stop` without a name lost the whole recording. With
  exactly one recording in progress there is nothing to disambiguate; with several, `default` stays
  the answer and the error now lists what IS in progress.
- **`@reticlehq/server` — `record { action: "stop" }` described an unreplayable step as "may be
  brittle".** `stable: false` does not mean brittle — it means the compiler found no testid, no
  accessible role+name and no component/source, so the step is pinned to a ref that dies with the
  session and can never resolve on replay. The agent learned the truth several calls later as an
  unhealable drift at `flow_verify`, by which point nothing on screen points back to the element.
  Capture time is the only moment the fix is cheap.
- **`@reticlehq/server` — `verify_change` no longer answers `no` on evidence it cannot attribute.**
  Observed in a sweep: `verified: "no"` because "1 of 1 covering flows failed (1 of them re-run only
  because Reticle cannot tell which sources they cover)" — a negative verdict whose own explanation
  admits the evidence is not tied to the changed file. A `no` now requires at least one failing flow
  genuinely attributed to the changed files, and names them; otherwise `unknown`, with the fix.
- **`@reticlehq/server` — `verify_change` treated an `unverifiable` suite as a failure.** Same call,
  same uncovered file, measured across a sweep: `no` on five apps and `unknown` on two, and all five
  also emitted a bug. The suite proved nothing and was reported as proof the change was broken.
- **`@reticlehq/server` — a role+name anchor was unhealable by construction.** `button named 'Menu'
  did not resolve` → heal answered "no nearest match cleared the confidence floor", which reads as a
  judgement about candidates; there were none to judge, because the role step returned `nearest:
  null` as a literal whatever the drift. It now looks — and role anchors are deliberately still NOT
  auto-healable: a testid is an identifier a developer put there, a role name is user-visible text
  where "Save" and "Save as" are one edit apart.
- **`@reticlehq/server` — `reticle_coverage` reported `exercised: 0` on any framework that replaces
  nodes.** Reported as `total: 34, exercised: 0` after four successful acts. Coverage was keyed by
  REF, and a ref dies with the next re-render — Next's app router replaces a whole route segment, so
  every control the agent drove is a new element by the time coverage is asked, and the number is 0
  forever while the agent re-drives ground it already covered. The bench app hid it by reconciling in
  place. A control now counts when its ref OR its label was driven, and matching also uses the
  testid.
- **`@reticlehq/browser` — an element with a role but no accessible name reported NEITHER.**
  `anchorOf` set `role` and `name` together or not at all, so an icon button, a clickable div or a
  control labelled by an SVG came back with no identity at all once React-specific component
  identification also found nothing. Two features read that identity and both degrade silently
  without it: the flow recorder anchors a step by it, and coverage recognises a re-rendered control
  by it. They are reported independently now.
- **`@reticlehq/server` — `reticle_clock` declared output fields it never returns.** The schema said
  `{ ok?, elapsed? }` and the browser command returns `{ frozen }`; MCP strips undeclared fields, so
  a successful freeze and a failed one both validated to `{}`.
- **`@reticlehq/server` — five reads where "found nothing" and "did not work" were the same JSON.**
  `network` with no calls at all, `animations`, `session { messages }`, `crawl`'s bare `stepsRun: 0`,
  and `affected` now state that the observation RAN. `affected` matters most: no saved flows, nothing
  changed, and no input given all returned the same answer, and only the first means "nothing to
  re-verify" — the others mean the question was never asked, which is how a regression ships. A
  refusal is never annotated, because "I observed nothing" on top of "no browser session connected"
  would be actively misleading.
- **`@reticlehq/server` — `crawl`'s zero now says which zero it is.** An empty page says the crawl ran
  and found none (and names snapshot truncation when the count is a floor); a `maxSteps` of zero says
  so; and controls-found-but-none-clicked says explicitly that this is NOT an empty page.
- **`@reticlehq/server` — the dev-server probe reported Apple's AirPlay Receiver as the user's app.**
  macOS ControlCenter listens on port 5000 by default on every Mac; the probe did a bare TCP connect,
  saw it accept, and told the agent something was listening while the app under test was on 3100.
  Measured, that port answers `HTTP/1.1 403 Forbidden … Server: AirTunes/950.7.1`. A dev server
  answers `GET /` with a document, so that is the test now. Fixing it surfaced a second defect in the
  same probe: it was pinned to `127.0.0.1`, and a plain `vite --port 4311` listens on `[::1]` only —
  so it could miss the very dev server it exists to find.
- **`@reticlehq/server` — a leaked daemon from another project said "authentication failed".** The
  token is not wrong, it is someone else's, and those need opposite fixes. The discriminator is
  evidence rather than derivation: the daemon and the SDK derive project ids by different schemes, so
  comparing them would report "different project" on every auth failure.
- **`@reticlehq/server` — `reticle_navigate { reload: true }` dropped the session on 6 of 6 apps.**
  The page came back as a NEW session while the agent still held the old id, and every later call was
  refused with "no browser session connected". The id is now remembered in `sessionStorage`, which is
  scoped to exactly the right thing — it survives a reload and is not shared with another tab. An
  explicit id still wins, so a leased tab that reloads rejoins its own lease.

### Fixed — install and integration

- **`@reticlehq/server` — `reticle init` wrote a syntax error into `next.config.js`.** The export
  patterns had no `m` flag, so `$` meant end-of-FILE and the capture always ran to the last non-blank
  character: any config whose export was not the final statement had everything after it swallowed
  into the wrap, producing an unbalanced paren. `next dev` then exited 1 while init reported the step
  as ✓ — and this had been sitting in the fixtures repo as a "flaky" fixture for three release runs,
  filed as a harness timeout, because the last 1500 characters of the dev log were all stack frames.
  Where the expression ends is now decided by a bracket-depth scan that skips strings and comments. A
  config that exports more than once goes to manual with a reason. With the syntax error gone, the
  fixture that found it booted in **37.8s instead of timing out at 300s**.
- **`@reticlehq/server` — a conditional Next export left the app unable to authenticate.** Which
  branch of a conditional export runs is an environment variable's business, so every top-level
  export assignment is now wrapped; a Sentry-wrapped config installs instead of deferring to the
  user. Without the wrapper the pairing token is never exposed to the client and the bridge refuses
  the connection.
- **`@reticlehq/server` — Astro auto-wiring was dead on both real Astro apps.** The rule was "exactly
  one `.astro` file in `src/layouts/`", and measured on two real projects it fired on neither: one has
  no `src/layouts/` at all, the other has three files there of which two are partials. A file COUNT
  cannot tell a layout from a partial and a directory NAME cannot tell you where the document shell
  is — `</body>` can. Both shapes now auto-wire; genuine ambiguity is still refused rather than
  guessed.
- **`@reticlehq/server` — Astro's two install steps are now atomic.** The config patch bailed while
  the connect snippet applied, producing an app with a snippet, no inlined pairing token and no
  raised build target — a guaranteed non-connection reported as one ✓ and one ⚠. The token is
  inlined by the config, so if either half cannot be applied both go manual with one recipe.
- **`@reticlehq/server` — an Astro config merge silently dropped `build.target`.** Merging into an
  existing `vite: { … }` inserted keys after the brace, giving the object TWO `build` keys — and the
  last one wins, so `target: 'es2022'` was discarded while init reported ✓. Astro's default target
  down-levels the modern SDK bundle and dies on a destructuring transform, so losing it while
  claiming success is a green that cannot go red. Colliding keys are now merged INTO; a colliding key
  that is not an object literal goes back to refusing.
- **`@reticlehq/server` — Astro's connect died on a dependency optimization it was never told about.**
  The Astro connect does `await import('@reticlehq/react')` and nothing declared the SDK to Vite, so
  Vite met the import mid-load, pre-bundled it, and the hashed URL the browser had already requested
  stopped existing. The import rejects, `connect()` never runs, and the page looks completely
  normal — no session, no error naming us — intermittently, depending on whether the dep cache was
  warm.
- **`@reticlehq/server` — monorepos outside `apps/` were invisible to `reticle init`.** Measured on a
  real repo with three Next apps at `web/`, `admin/` and `space/`: it found none, ran against the
  ROOT, warned about a `next.config.mjs` that exists nowhere, and reported ✓ for writing
  `app/reticle-dev.tsx` into a directory Next never compiles. It now reads what the workspace
  DECLARES (`workspaces`, `packages:`), and where nothing is declared it checks every top-level
  directory rather than two hardcoded names.
- **`@reticlehq/server` — `reticle init --app <dir>` picks the app in a monorepo.** The ambiguity
  refusal was correct but told you to re-run inside the app you want, which a script, a CI step or an
  agent that cannot change directory can do nothing with. A name that is not one of the discovered
  apps is refused and the real ones listed.
- **`@reticlehq/server` — Create React App had no automated connect path at all.** Init reported
  `⚠ Connect snippet → index.html`, a target that cannot work: CRA's `public/index.html` is a static
  template the bundler never processes for modules. The connect now arrives through `src/index.tsx`
  and the token through `.env.development.local` (CRA's own documented mechanism, gitignored by CRA's
  own template). CRA is detected after Vite, never before, because a project migrating off CRA can
  carry both.
- **`@reticlehq/server` — the CRA snippet did not compile.** `location.hostname` trips CRA's default
  `no-restricted-globals`, and the snippet also used top-level `await import(...)` — CRA is webpack 5,
  where top-level await is behind an experiment that is off by default. Fixing only the first would
  have handed the next user a parse error instead of a lint error. No gate in this repo can catch
  that class: the snippet is a string, so it is only ever compiled on a stranger's machine.
- **`@reticlehq/server` — a ⚠ on a connect step is not a warning, and `ok` said otherwise.** `ok` was
  hardcoded `true`, so a run whose connect step needed a human reported success — and nothing
  performs a manual step, so the app never dials the daemon and every tool answers "no browser
  session connected". The run now says, in words, that the app will NOT connect until the manual step
  is done.
- **`@reticlehq/server` — `mcpRegistered: true` when nothing was registered.** The flag was the
  negation of one narrow failure set, so a SKIPPED step (`--no-mcp`, which the install gate uses) and
  a MANUAL one both reported success — the onboarding funnel's most important field, wrong in the
  flattering direction on exactly the runs least likely to have a working install.
- **`@reticlehq/server` — `claude mcp get reticle` answered about the wrong scope.** Unscoped, it
  exits 0 for a PROJECT-scoped entry in some unrelated repo the user once ran init in, so the global
  registration was skipped and reported done and the agent had Reticle in one directory and nowhere
  else.
- **`@reticlehq/server` — `shell: true` on every exec broke paths with spaces.** It exists so
  `pnpm.cmd` and `npx.cmd` resolve on Windows; on POSIX the arguments are re-parsed, so
  `/Users/ada/My Projects/app` silently becomes two arguments and registration fails with nothing to
  read. Shell is now used only on win32.
- **`@reticlehq/server` — a stale `reticle` MCP entry could never be repaired.** Idempotency was
  key-presence only, so an entry left by an older release was reported "already registered" forever:
  an upgrade could not fix the thing an upgrade exists to fix. Repair is scoped to entries that look
  like ours, so a user pointing `reticle` at their own local build is left alone.
- **`@reticlehq/server` — a Cursor config that parses but is not an object was destroyed.** `[]`, `3`,
  `"x"` and `null` fell through to an empty config and the file was rewritten wholesale. Cursor is
  also now detected by a project-level `.cursor/`, not only by `~/.cursor`, which a fresh profile has
  not written yet.
- **`@reticlehq/vite-plugin` / `@reticlehq/next` — the install probes asked the wrong
  `node_modules`.** `isResolvable`, `sdkPackageVersion` and `sdkBuildFingerprint` all resolved
  `@reticlehq/react` from the PLUGIN's location, which under pnpm's strict layout cannot succeed, so
  all three silently returned the not-installed answer for an app that had the SDK installed. The
  consequences: no `sdkVersion` on the HELLO, so a skewed pair surfaced as a bare `-32000`; the build
  fingerprint pinned to the constant `'unknown'`, so Vite's `optimizeDeps` cache never noticed a
  changed SDK and kept serving the stale pre-bundle — the exact false negative the fingerprint was
  added to prevent, broken since it was added; and the SDK left out of `optimizeDeps` entirely.
  Measured in this repo's own bench app: version `''`, fingerprint `'unknown'`, resolvable false.
  `@reticlehq/next` reported `''` before and the real version after.
- **`@reticlehq/vite-plugin` — a dev server started BEFORE the daemon connects nothing, silently.**
  The pairing token is read from disk once, when Vite resolves its config, so a dev server started
  first — the common order, and what an automated harness does — bakes in an empty token and every
  app it serves opens a WebSocket the bridge then refuses. Nothing about that looks broken: the SDK
  module loads, the socket opens, a session simply never appears. The warning now fires where the
  value is FROZEN, because by the time the app is refused, restarting the dev server is the only fix.
- **`@reticlehq/vite-plugin` — the plugin named a dependency Vite cannot resolve.** The guard meant to
  prevent `Failed to resolve dependency: @testing-library/dom, present in optimizeDeps.include` tested
  NODE resolvability of Vite's nested `a > b > c` form, which under pnpm succeeds precisely where Vite
  fails — so the plugin emitted a three-segment chain Vite could not follow and the warning it exists
  to prevent appeared anyway, blaming Reticle and naming a package the developer has never heard of.
  Nested chains are gone; only the bare specifier, only when it resolves.
- **`@reticlehq/server` — `reticle update` updated the daemon and left the SDK behind.** The command
  whose job is keeping an install current was itself a way to create a version-skewed pair, and the
  skew message told people to fix an outdated SDK by running it. The app's `@reticlehq/*` packages are
  synced first, then the CLI (which execs and never returns), pinned to the exact target so an
  unpinned add cannot reinstall the very skew being fixed. Best-effort: a directory with no manifest
  has nothing to sync and must never stop the CLI half.
- **`@reticlehq/server` — `reticle update` refuses to install a downgrade.**
- **`@reticlehq/server` — a read-only `$HOME` no longer stops Reticle from starting.**
- **`@reticlehq/react` — source pointers were absolute Windows paths for two thirds of users.** The
  fast gate now also runs on Windows, which had zero coverage.
- **`@reticlehq/server` — the release could have shipped 40 stale `dist` files.** `tsc -b` is
  incremental and does not delete the output of a renamed file, so a regrouping left 40 orphaned `.js`
  files in the published tarball — one of them load-bearing, resolving only because of the stale copy.
  `prepack` now removes `dist` and rebuilds with `--force`. The shipped package metadata also
  advertised three retired tool names an agent would have called.

### Reliability

- **`@reticlehq/server` — the MCP server no longer exits when the daemon goes away.** The proxy
  retried with backoff and then called `process.exit(1)`, justified as "let the agent host respawn
  the proxy" — no host does that; a stdio MCP server that exits is marked DISCONNECTED and waits for
  a person to open `/mcp`. Exiting also bought nothing, because the dormant path already answers the
  handshake locally, answers `tools/list` from cache, and wakes a fresh daemon on the next request.
  Found in the wild: one machine's 3,283 lines of proxy history held 1,770 reconnects, 266 dormancies
  and one give-up — 61 consecutive `ECONNREFUSED` against `127.0.0.1:4400` immediately before the
  exit.
- **`@reticlehq/server` — an uncaught exception in the proxy no longer kills it.** The existing
  resilience handler was installed only on the DAEMON, whose rule is the opposite and correct for it
  (exit, because the next `reticle mcp` respawns it). Nothing respawns the proxy.
- **`@reticlehq/server` — a third way the server went down: `reticle mcp` exited when the bridge port
  was held.** A foreign daemon from another project, a half-dead process or a colleague's tool meant
  no daemon could bind and the MCP server never started AT ALL. Nothing about that is unrecoverable.
- **`@reticlehq/server` — `reticle mcp` never answered `initialize` against a wedged daemon.**
  Reported as "no tools ran at all". The proxy queued every client message until the daemon's
  endpoint frame arrived, and `initialize` is a client message, so the handshake waited on something
  never coming: 25s with nothing on stderr, and the reported client gave up at 60s. The handshake now
  completes locally after a bounded wait. The queued copy is DROPPED when answered locally, or the
  daemon would later answer the same id a second time and corrupt the stream.
- **`@reticlehq/server` — a locally-answered handshake left the client connected with NO TOOLS.**
  Measured over one editor session: 25 stream drops, 11 dormancies, 4 reconnects — and each fall back
  to the local handshake was a state where a human had to notice and type `/mcp`. The proxy now
  remembers the newest `tools/list` response it has seen and serves it when the daemon cannot.
  In-memory and per-process: a catalog persisted from a different version would be its own
  confidently-wrong answer.
- **`@reticlehq/server` — a lost daemon left tool calls hanging forever.** Killing the daemon under a
  live client left **5 of 10** tool calls and **20 of 20** concurrent ones hanging until the client's
  own 30s timeout, with the MCP server perfectly alive — an agent does not see "MCP disconnected", it
  sees a call that never returns, which it cannot even react to. Two populations, both now answered:
  FORWARDED-but-unanswered calls get a `-32001` under their own id saying the call did NOT complete
  and may be safe to retry (re-sending is not an option — a `reticle_act` that already clicked would
  click twice), and QUEUED-and-never-forwarded calls expire after 20s. After: **10/10 and 20/20**, and
  a port squatter is answered rather than hanging.
- **`@reticlehq/server` — a request that arrived with EOF was dropped and called success.** Write
  `initialize` + `tools/list` and close stdin in the same flush and the proxy answered only the first,
  then exited 0 — a supervising script saw no error, no missing-response signal, and a success status
  over a request that was never answered. A 4-second gap between the writes made it work, which is the
  signature of a teardown race. The proxy now tracks unanswered ids and drains for up to 5s on EOF;
  still owed means exit 1, because the exit status is the only thing a script reads. Verified on the
  built binary: pre-fix answered neither id and exited 0, post-fix answers both in 0.37s.
- **`@reticlehq/server` — the daemon idle-exited at 5 minutes and took live runs with it.** 187 idle
  shutdowns on one user's machine, in a repeating cycle of client-connected → 5 quiet minutes →
  shutdown → client-disconnected. In the install gate the same thing fired during long dependency
  installs, so apps that booted afterwards hit `ERR_CONNECTION_REFUSED` and were scored as INSTALL
  failures — one of them has no install defect at all. Reverting was not an option (daemons used to
  sit idle a median of 28 minutes at a 0.04% duty cycle). The distinction is TIME, not state: with a
  client attached the grace is now 6x the base, 30 minutes at the default, overridable with
  `RETICLE_IDLE_ATTACHED_MS`.
- **`@reticlehq/server` — a wait that cannot be evaluated is now a FAILED wait, not an eternal one.**
  The predicate check fires from an event listener and an interval, neither inside the awaited chain,
  so a throw there escaped as an uncaught exception and the wait promise stayed pending forever — the
  tool call simply never came back. An app that rebuilds its page session on every navigation makes a
  `route` predicate race a teardown of the session it is watching, which is exactly where that throws.
- **`@reticlehq/server` — a leased tab waited 30s for an event some apps never fire, then blamed the
  app.** `reticle_lease` on the SvelteKit fixture: **30,501ms**, failing with "could not open
  http://localhost:5180/ — is the app running?". The app was running. Playwright's `page.goto` defaults
  to `waitUntil: 'load'`, which waits for every subresource, and that page has one that never
  finishes. `DOMContentLoaded` is not a weaker bar here: the SDK connect is a module script, and module
  scripts run before it fires, and the pool waits for the session to register anyway. The same default
  was also live in the driven browser's own navigation, with no timeout at all. Measured on the same
  nine apps and 63 calls each: sveltekit **33,532ms → 2,942ms**, next14-mobx-monorepo **31,496ms →
  3,350ms**, fleet wall **101,850ms → 43,114ms**. The second of those previously reported ZERO browser
  time because it never got a working browser; it now reports 212ms of it.
- **`@reticlehq/server` — `reticle_navigate { reload: true }` no longer strands the agent.** The
  session id survives a reload, but the WINDOW between dispatching it and the new HELLO does not:
  every call in those seconds lands on the old, disconnected session — measured as `reticle_run`
  failing 5 of 5 and crawl answering "session disconnected" on a page that was healthy a moment later.
  The tool now WAITS for the reconnect, up to 5s, and returns `confirmed: true`; a timeout still
  reports `confirmed: false` so nothing claims an arrival it did not observe. The reload branch also
  disclosed nothing at all before — it returned a bare `{ ok: true }` where the URL branch had always
  said `ok` means the browser accepted the instruction, not that the page arrived.
- **`@reticlehq/server` — a displaced session now names what displaced it.** A session is only ever
  replaced by one claiming the SAME id, so the disconnect message carries that id and the URL that
  claimed it. A diagnostic, not a fix for the underlying report.

### Performance / token cost

- **`@reticlehq/browser` — every agent action waited 450ms to animate a cursor nobody was watching.**
  Measured across the e2e battery with tracing on: 42 `act` round-trips, 40 of them in a 452–460ms
  band — a fixed cost, not app work — totalling **19.7 seconds, 98.5% of ALL the time the battery
  spent in the browser**, while every other command was 1–4ms. That is the HUD cursor glide, which is
  the product working as intended in a browser somebody is looking at and 450ms of nothing in a
  headless one. `navigator.webdriver` now decides, and an explicit `paceMs` always wins so a recorded
  demo still glides. Same battery, same 42 acts: act mean **468ms → 16ms**, act median **459ms → 7ms**,
  act total **19,657ms → 675ms**, all browser time **20,059ms → 1,088ms (18.4x)**. An agent loop of
  50–200 actions was paying 22–90 seconds for an animation with no audience.
- **`@reticlehq/server` — `reticle_state` returned about 1,500 tokens of fiber plumbing for two useful
  values.** Measured on a real React 19 render (5 `useState`, `useRef`, `useMemo`, `useCallback`, 3
  `useEffect`) through the same path the tool uses: **2,632 → 1,333 bytes, a 49% cut**, and everything
  removed was plumbing — the three effect entries were ~1,300 of those bytes on their own, because
  `next` re-chains the whole effect list into every entry, so N effects cost O(N²). Deliberately NOT
  dropped: `useMemo`/`useCallback` `[value, deps]` tuples, the largest remaining cost (~900 of the
  1,333 bytes). React exposes no hook KINDS at this layer, so `useState(['lat', ['a','b']])` is
  byte-identical to a memo tuple and stripping element 1 would silently delete real state to save
  tokens — the exact class of bug the rest of this release removes.
- **`@reticlehq/server` — `wait_for` and `act_and_wait` stopped paying a blind poll interval after
  settle had already closed.** Measured across the nine-app fleet: both are bimodal, ~0ms when the
  predicate is already true and otherwise 566–627ms, of which 500ms is the definition of "settled"
  and must not move. The rest was a 150ms backstop poll landing wherever it happened to land, on the
  call an agent makes after almost every action. A quiet-window failure now reports `retryAfterMs` and
  the waiter schedules one re-check at that moment. Settle waits land near **505ms instead of ~600ms**,
  verified by re-running the fleet.
- **`@reticlehq/server` — a replay anchor wait ends on the DOM event, not on the tick.** Found by the
  new trace: on a Next app-router fixture a single step was **1079ms wrapped around nine query
  round-trips of 1–2ms each** — the entire cost was the sleeping between them, and four such steps
  were 4.3s of that app's 7.6s. It can only resolve a wait EARLIER, never end the loop earlier, so a
  genuinely missing anchor still spends the full settle before it drifts.
- **`@reticlehq/server` — two in-memory session waits poll at 25ms instead of 100ms.** What is polled
  is a map lookup with no I/O while the thing waited for is an event, so a 100ms grid added a full
  interval of dead time after the fact. Visible in the fleet trace: `reticle_navigate` clustered at
  105 / 202–206 / 308 / 407ms — the poll grid itself showing up in the data.
- **`@reticlehq/server` — `reticle_feedback` no longer waits out the network** (~340ms measured). See
  the breaking note on `sent` / `accepted`.

### Changed

- **`@reticlehq/server` — CLI usage errors name the argument that was rejected.** Every mistake — a
  typo'd flag, a flag missing its value, an unknown command — produced the same wall of JSON-escaped
  help text on one stderr line, naming nothing. One install-gate failure was reported, verbatim, as
  600 characters of unrelated help. Now: `unknown argument '--bogus'`, `--app needs a value`,
  `--port expects a number, got 'x'`, `verify needs a url`, `unknown command 'nope'` — with the help
  rendered as readable text underneath. Two audiences, two channels.
- **`@reticlehq/server` — bare `reticle gate` and `reticle affected` now mean the working tree**
  (`--since HEAD`), which is the question being asked when you reach for them. The rule init writes
  into `CLAUDE.md` says to run `reticle gate`, and the parser answered "usage:".
- **`@reticlehq/server` — three commands in the generated agent rules named a `reticle` binary that
  init never installs.** Init wires the SDK, not the server. They are now `npx @reticlehq/server …`,
  derived from the package's own name so the rule and the MCP registration cannot drift.
- **`@reticlehq/server` — the Cursor rule and both `/reticle` command files are now compared by
  CONTENT, not by existence.** A Cursor-only project froze its rule at whatever release wrote it and
  could never receive a later one. A command file without our frontmatter signature is somebody's own
  `/reticle` and is left untouched.
- **`@reticlehq/server` — `--no-mcp` skips the agent rule files and the `/reticle` command too**, and
  now says so, because all three only make sense once the tools are reachable. A gate running with
  that flag covers far less than it appears to.
- **`@reticlehq/vite-plugin` — the dependency-optimizer option key is chosen from the installed Vite's
  major.** Vite 7 moved the optimizer to rolldown and deprecated `optimizeDeps.esbuildOptions`,
  warning on every boot — and that warning names the plugin that set the option, so it read as Reticle
  nagging about Reticle. The version is read from the APP's root, not the plugin's, because in a
  monorepo those resolve different Vites and the user sees the app's. Unknown versions keep the older
  key: a deprecation notice is a much smaller failure than an option the installed Vite has never
  heard of.
- **`@reticlehq/server` — `reticle doctor` prints the daemon log path** (it always existed and nothing
  said so) and whether tracing is on.
- **The registered MCP command stays unpinned (`npx @reticlehq/server mcp`), deliberately.** Pinning
  would close a release-day skew window but freeze the agent's server at install version forever, and
  `reticle update` upgrades the CLI, not a global agent config. Fixes not reaching people is Reticle's
  biggest measured problem.

### Observability & telemetry

- **`@reticlehq/server` — every log line carries an ISO-8601 wall clock, first.** Reported after four
  MCP disconnects: 20MB of daemon events with no timestamps on any line, so no event could be
  correlated with a wall clock and no outage could be placed in time. Ordering the clock first also
  means a huge file can be bisected by eye and by `sort` without being parsed.
- **`@reticlehq/server` — the proxy's crash handlers now write to the proxy log.** They were wired to
  stderr only, so an uncaught exception in the proxy — exactly what a human experiences as "the MCP
  server disconnected" — was handled and then thrown away by the editor. The proxy log is also
  per-port now (`proxy-<port>.log`), matching the daemon's, because one shared file interleaved every
  proxy on the machine.
- **`@reticlehq/server` — daemon logs roll at 8MB.** They were unbounded and one had reached 24MB.
  Rotation happens before the append handle is opened; rotating after would leave the daemon writing
  through a descriptor to a name nobody can find.
- **`@reticlehq/server` — every in-process exit is traced**, with its code, and SIGTERM/SIGINT/SIGHUP
  by name. After this, silence in the log is itself a finding: it narrows to SIGKILL or an OOM abort,
  which nothing in-process can record.
- **`@reticlehq/server` — `RETICLE_TRACE=1` turns the daemon's log into a per-stage trace.** One line
  per stage when it ENDS, carrying its own duration, a `callId` grouping every stage of one tool call,
  and a `depth` making it a tree; the id and depth ride in `AsyncLocalStorage`, so instrumenting a
  function five frames down needs no signature change. Off by default, and the cost when off is
  measured rather than asserted: **126ns per disabled span site against ~9ns for a bare call** — the
  `process.env` read. Nearly everything in the performance section above was found with it, including
  the init flow, which is synchronous end to end and had no timings at all: planning is ~2ms, so
  init's wall clock is essentially all subprocess, and the degraded path runs the package manager
  TWICE (a pinned install then a full unpinned retry), which is where 1.6 of one 2.3-second init went.
- **`@reticlehq/server` — losing MCP is now a number.** `mcp_connection_lost` reports the stage
  (`first`, or `budget_spent` when the proxy stopped retrying), the cause and the attempt count, so
  "what share of sessions lose MCP at all, and how often does it never come back" is answerable.
  Capped at TWO events per proxy process, and the cap is the design: one measured afternoon produced
  547 proxy reconnects, and an event each would bill for the pathology instead of measuring it.
- **`@reticlehq/core` / `@reticlehq/server` — `RETICLE_TELEMETRY_FILE` records events locally and
  sends NOTHING.** Set it to a path and every event is appended as one JSON object per line, built by
  the same code and redacted by the same rules as the wire payload. A release sweep is not a user:
  driving dozens of sessions through a gate emits real events that are indistinguishable from people
  in the dashboard. Verified on a real session: 11 events recorded, zero on the network, roll-up
  intact.
- **`@reticlehq/server` — `bug_found` stopped counting Reticle's own failures**, 34 of 34 in one run.
  Two causes. `reticle_run` is a wrapper whose handler calls the real tool, which already reported
  that result's defects under the real tool's name, so the outer chokepoint reported the same object
  again — the sweep was a perfect mirror image, and 16 of the 34 were echoes. A headline number that
  doubles because of HOW a tool was reached is not a measurement. Second: a suite that failed because
  nothing could RUN is not a regression in the user's app. Genuine failed assertions and genuine flow
  regressions still count, and tests pin that.
- **`@reticlehq/server` — a refused `act_and_wait` is excluded from `verification_completed`.**
- **`@reticlehq/server` — `reticle_installed` never fired: 15 `init_completed`, 0 installs.** The
  human-command filter sat above the install event, so on the machines where the first-ever contact is
  the agent spawning `reticle mcp` — most of them — the top of the funnel was silently skipped.
- **`@reticlehq/server` — the feedback report is no longer sent on a metric's budget.** 2s, no retry,
  no persistence, for the only qualitative channel the product has, carrying an agent's whole
  root-cause analysis. Measured to the collector with a WARM DNS cache: **0.694s total, a third of the
  budget gone before a byte of payload moves, on the GOOD path** — and a cold short-lived CLI process
  pays cold DNS and a cold route on top. Feedback now gets 15s and one retry with backoff (a 4xx is
  not retried; the payload will be rejected again), and every report is appended to
  `~/.reticle/feedback-outbox.jsonl` BEFORE the network is touched and removed on delivery, so
  `sent: false` means "queued, not lost" and the receipt says where it is. The source-checkout guard
  no longer silences feedback either — that rule is about PASSIVE collection, and somebody typed this;
  applying it there meant anyone dogfooding from their own checkout filed nothing and was told "not
  sent, unknown reason".
- **All 15 telemetry event kinds are documented, and a test keeps it that way.** The contract doc
  described 7. The other 8 existed only in the enum — including the MCP-outage metric this release is
  largely about, and `init_completed`. A kind nobody documents is a kind nobody queries.

### Internal

- **`pnpm test:coverage` reports every package.** There was no coverage tooling at all, which makes
  "is coverage high enough to release?" a question nobody could answer. Baseline, statements: core
  98.65%, vite-plugin 91.11%, browser 91.09%, test 90.57%, react 87.03%, server 85.05% — weighted
  87.3% (29,755/34,093). No threshold is enforced yet; a number nobody has looked at is not a gate.
- **Four brute-force stress specs now sit in the battery**, covering each transport rather than only
  the MCP one: ten consecutive daemon kills and a 20-way concurrent burst across one; the
  daemon↔page socket under a tab closed mid-command, two tabs at once, and a reload underneath a live
  ref; the bridge socket itself under 40 connections against a cap of 32, malformed and oversized
  frames, a 5,000-message flood and 60 sockets killed mid-handshake; and a 48-tool argument fuzz. The
  bridge cap holds at exactly 32 and every abuse leaves the daemon serving.
- **Three load-only flakes fixed, all the same shape:** asserting a DURATION where the invariant is a
  BOUND. One spec passed 6/6 alone and failed in the battery, which is the signature of a test
  reporting load as a defect. A telemetry spec that slept a fixed 700ms fifteen times now waits for
  the capture endpoint to go quiet instead — idle machines settle in ~120ms, loaded ones wait as long
  as they need.
- **`eqeqeq` comparisons put the literal on the left**, enforced by eslint across 1,324 comparisons in
  352 files: `if (5 = x)` is a syntax error where `if (x = 5)` silently assigns.
- **The dead-code report went from 95 findings (95% false positives, i.e. an ignored report) to a
  handful.** 73 symbols and 74 types that no file outside their own ever named lost their `export`;
  four genuinely-dead exports and one unreachable function were deleted; the two remaining false
  positives are documented by name rather than silenced. One real finding: an app was building only
  one of its two pages, so a source file was unreachable from the build graph while working fine under
  `vite dev`.
- **No `eslint-disable`, `@ts-ignore` or `@ts-expect-error` remains anywhere in `packages/*/src`.**
- **The server's 37-file `src` root is grouped into five directories** (56 files moved with their
  tests, 60 files rewritten by computed path rather than pattern match). One runtime `createRequire`
  path survived every static check and broke 82 test files while `tsc --noEmit` reported zero errors.

## [2.4.1] — 2026-08-08

**False greens, and a metric that was measuring the wrong thing.** Almost every fix here was found by
driving the shipped MCP surface against a live app and reading what came back — 994 adversarial calls
with hostile arguments generated from each tool's own schema, plus one realistic verification session
with every telemetry event captured on a local endpoint. Three of these change behaviour: a flow that
was green because nothing was checking it will now go red, a misspelled predicate key is now refused
instead of silently weakening the assertion, and a verification suite with no flows no longer passes.

### Fixed — verifications that could not fail

- **`@reticlehq/server` — a step's `signal` / `net` / `console` assertion is now EVALUATED on replay.**
  Replay checked exactly two things per step (element presence, and `expect.state`), so an assertion
  recorded by `reticle_annotate { kind: 'assert-signal' }` was written to disk and read by nothing —
  while `reticle_flow_save` graded the flow `"asserted"`. Driven end to end: annotate a step with a
  signal that never fires, save (grade `asserted`), replay → `status: "ok"`. It now reports `drift`
  with the reason. Step expects compile through the same converter the flow-level `success` has
  always used, so the two forms cannot diverge again.
  **This turns previously-green flows red.** That is the point — they were green because nothing was
  looking. Run `reticle verify` after upgrading and expect to find real failures.
- **`@reticlehq/server` — a misspelled predicate key is refused instead of weakening the check.**
  `until: { kind: 'route', path: '/checkout' }` silently dropped `path` (the field is `pathname`,
  though the `state` predicate in the same union spells it `path`) and degraded to "any route
  change". Five predicate kinds have all-optional fields, so a plausible-but-wrong key left a
  tautology: `{net, url}` became "any network call at all". Every branch is now strict, and `path` /
  `url` / `data` are accepted as aliases for `pathname` / `urlContains` / `dataMatches` so a
  rejection is not simply a different dead end.
- **`@reticlehq/server` — `since` now works on `signal`, `route` and `animation` predicates.** It
  existed only on `net` and `console`, so an assertion scoped to the action that had just run was
  really "at any point in the window". Found by the strictness change, in this repo's own e2e battery.
- **`@reticlehq/server` — a suite with no flows no longer reports `pass`.** `reticle_flow_verify` on a
  project with no flows returned `status: "pass"`, `"all 0 flows pass"` — so the CI gate went green on
  every project that had not written a flow yet, and on any project where the flows directory failed
  to resolve. It now reports `unverifiable` and says what to do.
- **`@reticlehq/server` — an ordinary React navigation is no longer reported as a blank destination.**
  `route-rendered-nothing` looked only for added/removed nodes, so a destination React reconciled IN
  PLACE looked identical to one that rendered nothing. Measured on three ordinary navigations: each
  emitted `dom.attr`, `dom.text` and `render.commit` and zero `dom.added`/`dom.removed`. Correct
  greens came back `verified: "no"` and each emitted a bug. In a live session, bugs went 4 → 1.
- **`@reticlehq/server` — an agent's own malformed call is no longer reported as a defect in the
  user's app.** `until: { kind: 'state' }` without naming a store returned `verified: "no"` — and that
  path emits `bug_found`. It is now `unknown`, with the missing argument named, and emits nothing.

### Fixed — telemetry that was measuring the wrong thing

- **`@reticlehq/server` — a FAILING verification suite is now counted.** `verification_completed`
  fired only when a suite passed, while `bug_found` fired on the reds — so the data showed defects
  with no verification to divide them by, and a CI verify that went red was invisible.
- **`@reticlehq/server` — a periodic flush is no longer emitted as `daemon_stopped`.** The 30-minute
  roll-up reused the exit event, so 98 `daemon_stopped` events in one day were 73 real exits plus 25
  flushes. It is now `session_progress`, and the flush interval is 5 minutes rather than 30 (the
  interval is the bound on what is lost when a working daemon is finally killed).
- **`@reticlehq/server` — a repeated defect is no longer counted as a new one.** The flush cleared the
  seen-bug-kinds memory along with the window counters, so the same defect re-found after a flush
  reported `repeat: false`.
- **`@reticlehq/server` — `reticle mcp` no longer emits `cli_command_run`.** It is the agent's MCP
  transport, which nobody types, and it was 85% of that event. `mcp_client_connected` already reports
  an agent attaching, with more detail.
- **`@reticlehq/server` — one-shot CLI commands no longer mint a `sessionId`.** The id is per-process,
  so `reticle status` invented a session that joined to nothing: of 704 distinct ids in one day, 561
  came from CLI runs and not one was shared with a daemon. Any chart counting sessions was ~6x high.

### Added

- **`@reticlehq/core` / `@reticlehq/server` — version and contract agreement is reported to the
  agent.** When the SDK, the daemon and the agent's MCP server disagree on the wire contract, the next
  tool result carries `version_skew` naming which pair differs and the exact fix (`reticle stop` for a
  stale daemon; install the matching SDK and restart the dev server for a stale page). Matched
  installs stay silent — the signal is a derived contract fingerprint, not version equality, so a
  patch release does not cry wolf.
- **`@reticlehq/server` — `reticle init` now REFRESHES its managed instruction block.** It previously
  returned "already wired" on sight of the marker, so a project that ran init once kept that release's
  rule text forever and every improvement reached only new projects. Content outside the markers is
  never touched, and a malformed block (begin with no end) is left alone rather than risking someone's
  file.
- **`@reticlehq/server` — the agent rule block tells agents what to do with `version_skew`.**
- **`@reticlehq/core` — verifications record how the browser got there** (`headless` / `headed` /
  `attached`), so "verifications run" stops being one number covering unattended CI, a human watching
  an agent, and the SDK in somebody's own dev server.
- **`@reticlehq/core` — five session metrics that answer questions the data could not.**
  `noSessionErrors` (tool calls that failed because there was no app to reach — the largest drop-off
  in the funnel, previously reachable only by unpacking an array), `consecutiveRepeats` (longest
  back-to-back run per tool, so a retry loop stops looking like engagement), `abandonedActions`
  (actions left with no verdict after them), `tzOffsetMin` (time-of-day without relying on GeoIP), and
  `versionChange.nudged` (whether the update banner is what caused the upgrade).

### Changed

- The file line cap moved from 600 to 1000. Cohesion is still the rule; the number is the backstop.

### Internal

- Two new e2e specs, both browser-free where possible: `version-skew-test` drives all three agreement
  states with a fake peer and a hand-rolled HELLO that lie about their contract, and
  `telemetry-stitch-test` runs a real session and checks the captured events describe it. The battery
  is 21 specs.

## [2.4.0] — 2026-08-07

**Setup, and the honesty of the regression suite.** Almost every fix here was found by installing the
published build into real applications — a Vite+React admin console, a Preact client with 200
dependencies, Next on both routers, SvelteKit and Astro — and then driving each one over MCP with a
live browser tab. Nothing was found by reading the code. Minor rather than patch because it also adds
three state adapters, a CLI flag and two connect options. On-disk flow files stay version 1.

### Behaviour changes — read these before upgrading

Two changes alter what an existing caller gets back.

- **`reticle_flow_verify` can now return `status: "unverifiable"`.** A flow with no steps, or one that
  asserts no observable consequence, used to be counted in `passed` and reported as `pass` — a green
  that could never go red. Those flows are now listed in a new `unverifiable` array with the reason,
  `passed` counts only what was actually verified, and the suite cannot claim `pass` while it holds
  one. **A gate written as `status === 'pass'` will now see a third value**; a gate written as
  `status !== 'fail'` will silently keep passing empty flows and should be tightened.
- **`reticle drive` shows the browser by default.** It is the command you run when you want to watch,
  and asking people to opt into seeing their own app was backwards. `serve` / `mcp` are unchanged and
  stay headless — they own the pool behind leases, flow replay and the spec runner, which are batch.
  Pass `--headless` to hide `drive`, `--headed` to show the others; `CI` hides `drive` automatically.

### Fixed

- **Next.js connected 0% of the time, for three independent reasons** (`@reticlehq/next`, `@reticlehq/server`).
  1. `withReticle` added a `webpack` key and no `turbopack` key. Next 16 — what `create-next-app@latest` installs — defaults to Turbopack and treats that combination as a hard startup error, so `next dev` **died on boot** for every new Next app. It now configures both bundlers, and Turbopack gets `data-reticle-source` stamping for the first time.
  2. The `reticle-dev.tsx` that `init` generated called `reticle.connect({ projectId })` with no pairing token, so the browser logged `bridge refused the connection: authentication failed` and no session ever appeared. It now reads the `NEXT_PUBLIC_RETICLE_TOKEN` that `withReticle` publishes. The token path existed on both ends and was never joined in the middle.
  3. Next was the only stack still requiring hand edits — wrapping `next.config` and mounting `<ReticleDev />` in the root layout, a JSX edit. `init` now patches both, under the same conservative rules the Vite config gets (recognise the obvious shape, bail to a printed snippet on anything else). A `--src-dir` app also gets the component written next to its layout instead of at `app/`, where the generated relative import pointed at nothing.
- **The FIRST page load after `reticle init` connected nothing, on every Vite app** (`@reticlehq/vite-plugin`). The plugin declared the SDK's transitive CJS dependencies in `optimizeDeps.include` but not `@reticlehq/react` itself, so Vite only learned about it when the injected connect module was requested — mid-flight, during the first load. Vite then pre-bundled it and forced a full reload, and the connect was lost in that reload: no WebSocket, no session, and **no console message**. The second load worked. That is the worst possible shape for this bug: the install looks broken, and it looks fixed the moment anyone refreshes to investigate — which is exactly what "it took an hour to set up" is made of. Reproduced on a real Vite 4 app with a cold dep cache, and only caught because the fixture repo runs against a clean tree where the cache is genuinely cold.
- **The regression suite green-lit a flow that could not fail** (`@reticlehq/server`, `@reticlehq/core`). A flow saved as `{"steps": [], "intent": "navigate to a demo route"}` — which `flow_save` had ALREADY graded assertion-free and `empty: true`, with a warning that it "claims to verify a goal it does not assert" — replayed green, and `reticle_flow_verify` answered `{"status":"pass","total":1,"passed":1,"summary":"all 1 flow pass"}`. The grader had said the flow was worthless and the verdict said everything was fine anyway: a permanent false green in the exact feature sold as the regression suite. A green that cannot go red is no longer counted as a pass — such flows are reported as `unverifiable` with the reason, `passed` stays a count of things actually verified, and the suite cannot claim `pass` while it contains one. A real failure still outranks them.
- **`/reticle` did not exist** (`@reticlehq/server`). SKILL.md told the user "Type `/reticle` anytime to verify the app" in three separate places, and `init` never wrote the file that makes a slash command exist — so the single most obvious way into the product silently did nothing, in every tool, for everyone. `init` now creates `.claude/commands/reticle.md` and `.cursor/commands/reticle.md`, and the command is deliberately scoped to **one flow**: someone installing Reticle has an existing app with dozens of them, and an agent told to "verify the app" spends ten minutes instrumenting everything and producing nothing to look at. It also states that driving needs no `data-testid` — `reticle_snapshot` addresses elements by role and name — because believing otherwise is what turns a two-minute setup into an afternoon.
- **Three calls in `SKILL.md` were invalid as written** — `reticle_snapshot({ maxDepth })` (no such parameter; it is `mode`/`diff`/`scope`), `reticle_act_sequence` called directly (not advertised under the default `hybrid` profile, so it needs `reticle_run`), and the tool counts, given as "~14 core" in one place and "~12 core" in another when the real number is 16. Profile sizes are now measured rather than estimated: `hybrid` 16 tools / ~74k chars, `standard` 33 / ~117k, `full` 46 / ~166k. The docs also now say that `RETICLE_TOOL_PROFILE` is read by the DAEMON at startup — setting it in a client's environment while a daemon is already running changes nothing, which makes two different profiles look identical.
- **`SKILL.md` claimed a gate that does not exist.** "Vite + React, Next.js, Remix, Astro, and plain HTML each have an app in this repo and a CI gate that drives it" — there is no plain-HTML app and no gate for one. The four that are real are now named with the gate that drives each, and hand-wired stacks are stated to have neither.
- **Setup ended at "connected", which is not a result** (`SKILL.md`). A user installed something and watched nothing happen; the payoff was deferred to a `/reticle` that did not exist. Setup now ends by driving one real flow in the visible tab, with the HUD on and a narration line per step, before it reports success.

**The state-truth read was unavailable on every app out of the box** — `hasCapabilities: false`, empty capabilities, and a `reticle_state` holding nothing but `__reticle_renders`, on all six apps measured. SKILL.md calls registering a store "the highest-value line"; `init` wired neither it nor `registerCapabilities`. Three separate defects sat behind that:

- **Nothing generated the calls** (`@reticlehq/server`, `@reticlehq/vite-plugin`). `init` now writes `src/reticle-dev.ts` with `registerCapabilities` populated from a scan of the app's own `data-testid` values, and the `registerStore` line **commented and named for the state library actually found in `package.json`** — TanStack Query first, because a stale cache served as fresh fires no network request, so the network log shows silence and the cache is the only witness. The store line stays commented on purpose: detecting that an app depends on zustand is easy, knowing which module exports the store instance is not, and a wrong import breaks the module everything else hangs off. The Vite plugin imports the file by CONVENTION, so `init` never has to edit the entry file the user owns.
- **Capabilities registered after connect were never announced** (`@reticlehq/browser`). `hasCapabilities` rides in the HELLO, sent at `connect()` — but registering deliberately happens after connect, because `registerStore` needs a live SDK to subscribe through. So an app that declared its entire testable surface still reported having none. The registry now notifies the transport, which re-announces. The hook is on the bare `registerCapabilities` rather than on `reticle.describe`, because the bare function is the documented entry point and wiring only `describe` would have fixed the path almost nobody uses.
- **Re-announcing killed the session** (`@reticlehq/server`). The bridge answered a second HELLO with `hello already received` and closed the socket, so the fix above would have been strictly worse than the bug. A repeat hello on the same socket for the same session is an identity refresh, not a violation; one bearing a *different* session id still is, and that is the case the guard exists for.

- **Upgrading the SDK in place left the OLD code running in the browser** (`@reticlehq/vite-plugin`). Vite's dep-optimizer cache is keyed on the `optimizeDeps` config and the lockfile — not on the contents of the packages it pre-bundled. Patch the SDK without changing its version (a linked checkout, an overlay, a hand-applied fix) and `node_modules/.vite` keeps serving the stale copy across dev-server restarts. The symptom is the worst kind: the same version in `package.json`, old code in the browser, and **the fix you just shipped appears not to work**. It cost a false negative while verifying the null-fiber crash — the fix was in the tree and the bug was still reproducing until `rm -rf node_modules/.vite`. The plugin now mixes the installed SDK's build fingerprint into the optimizeDeps cache key, so Vite re-bundles when the SDK on disk changes.
- **`reticle_inspect` and `reticle_act` disagreed about the same element** (`@reticlehq/browser`). `describe()` reads the cheap DOM-attribute source because it runs per element on paths that describe hundreds at once; single-element paths are supposed to use `sourceFor()`, which asks the framework adapter first — it knows the component that RENDERED the element, not just the nearest stamped host. `act` did this, `inspect` did not. So on any app whose source comes from the fiber rather than a babel stamp, `inspect` reported `source: null` while `act` on the very same ref returned a path — and `inspect` is the tool an agent reaches for to ask where something lives. Three of six real apps were affected. The code comment in `a11y.ts` had named `inspect` as a `sourceFor()` caller the whole time.
- **An app the agent could see perfectly and could not touch** (`@reticlehq/react`). React writes `_debugSource: null` on fibers it has no JSX source for, but the fiber type declared it `?: DebugSource` — "absent or a DebugSource" — so the `!== undefined` guard let the null straight through to `fiber._debugSource.fileName` and threw `Cannot read properties of null (reading 'fileName')`. `identify()` is on the ACT path as well as the inspect path, so ONE null fiber anywhere in the walk took out `reticle_act`, `reticle_act_and_wait` and `reticle_inspect` for the entire app, on every ref. The read-only tools — snapshot, query, assert, network, console, state — were unaffected, which is what made it look like a per-element problem rather than a dead capability. The throw also pre-empted the React 19 attribute fallback immediately below it, which would have produced the source anyway. Found by driving six real apps over MCP stdio: two of the six could be observed and not driven. The type now says `DebugSource | null` (and `columnNumber?: number | null`), so the compiler catches the next one.
- **Installing Reticle stopped a Pages Router app booting at all** (`@reticlehq/server`) — the worst outcome an installer can have, and it happened TWICE in the same generated file. First, one hardcoded path got two things wrong at once. It wrote `pages/reticle-dev.tsx`, and (a) **every file under `pages/` is a route**, so the app gained a route with no default export — `/reticle-dev` 500s and `next build` fails; (b) a `.tsx` file in a JavaScript project makes Next auto-install TypeScript on the next `next dev`, which on Next 13 takes its `require-hook` down with it so the dev server never starts. The component now goes to `components/reticle-dev.<ext>` (outside the route directory, `src/`-aware) with the extension matching the project's language, and `pages/_app` imports it from where it actually landed. App Router is unchanged — `app/` routes on filename, so a sibling there is inert. Then the fix for it shipped a **regression**: the extension was corrected while the BODY still carried a TypeScript cast (`(globalThis as Record<string, unknown>)`), which SWC cannot parse in a `.jsx` file, so every route served 500 again. The project root is now a `connect()` option rather than a global the generated code assigns, which keeps that file plain JavaScript — and a test asserts the generated body contains no TypeScript-only syntax at all, because catching this by eye failed twice.
- **Astro reported absolute source paths** (`@reticlehq/server`) — its printed recipe defined the pairing token but not the project root, so it was the one framework still emitting `/Users/you/...` where the others emit `src/Counter.tsx`.
- **Only Vite apps got a capabilities scaffold** (`@reticlehq/server`). The generated Next component had none, so half the frameworks were back to `hasCapabilities: false` even after `init` learned to write one.
- **A pnpm-installed project with no committed lockfile was treated as npm** (`@reticlehq/server`). `npm i -D` then died on pnpm's symlink layout with `Cannot read properties of null (reading 'matches')` — and left the package present in `node_modules` but absent from `package.json`, so every later run reported the same failure. A setup that cannot be retried into working is worse than one that fails outright. Detection now reads the markers an installed tree leaves behind (`node_modules/.modules.yaml`, `.yarn-state.yml`, `.package-lock.json`); a committed lockfile still wins.
- **`pnpm add` installed 2.2.1 while npm and yarn took 2.3.0** (`@reticlehq/server`) — a stale registry metadata cache, invisible to everyone. A version-skewed SDK against a newer daemon is the `-32000` path: the app connects, the protocol disagrees, and nothing on either side names a version. `init` now pins the SDK to the CLI's own version, which makes the cache irrelevant and a skewed pair impossible to install by accident.
- **`⚠` meant two different things** (`@reticlehq/server`). The UNVERIFIED lines for Preact and SvelteKit are notices — the app is wired and working, it just isn't covered by a CI gate — but they were emitted as manual steps, so "steps left to do" was a number that could never reach zero and a release gate read two regressions that were not regressions. Notices now have their own mark (`ℹ`) and are excluded from the manual count; `⚠` means work left to do and nothing else.
- **The Vite config patch left trailing whitespace** (`@reticlehq/server`) — `[reticle(), ` before a newline, which is exactly what a formatter rewrites, turning a one-line install into a diff against the user's own style. The insert is now spaced to match the line it lands on.
- **`optimizeDeps` named packages the app might not have** (`@reticlehq/vite-plugin`), so a SvelteKit app logged `Failed to resolve dependency: @testing-library/dom, present in optimizeDeps.include` on every boot — a scary line blaming Reticle for a problem that does not exist. Only resolvable entries are declared now.
- **SvelteKit's generated client hook connected with no pairing token** (`@reticlehq/vite-plugin`, `@reticlehq/server`) — the same defect Next.js shipped, in the other hand-written connect. The bridge requires the token even on localhost, and nothing in a browser can read the file it lives in, so `src/hooks.client.ts` called `connect()` with no credential and got `bridge refused the connection: authentication failed`: app boots, no session, one console line nobody was looking for. The Vite plugin now inlines the token as a `__RETICLE_TOKEN__` define, which any hand-written connect in a Vite app can read, and the generated hook uses it. Measured on a real SvelteKit app: no session → connected in 3.0s.
- **Pages Router apps got a component nothing imported** (`@reticlehq/server`). A Pages Router app has no `app/` directory at all, so `init` wrote `app/reticle-dev.tsx` into a directory that does not exist and the mount step had no root layout to find. It now detects `pages/_app.*` and wraps the page component there instead. Found within minutes of the fixture repo existing, which is the entire argument for it.
- **Astro was detected as plain HTML** (`@reticlehq/server`). Astro SSRs its own HTML and does not list `vite` as a direct dependency, so it fell through every branch to the generic HTML advice — which tells you to add a connect to an entry module Astro does not have, or to bundle the SDK with esbuild. Neither works, and `SKILL.md` has offered Astro as a gated framework throughout. It is now its own framework with instructions that match the recipe the repo's own Astro example uses: a page `<script>`, the pairing token inlined through `vite.define`, and `build.target: es2022` (Astro's default down-levels the SDK bundle and dies on a destructuring transform). The wiring is still by hand — auto-patching it means choosing which page or layout to edit, which is not a choice to make silently.
- **`init` at a monorepo root wired the root** (`@reticlehq/server`). With the app in `apps/web`, it detected "no framework", printed the manual HTML instructions, and would have installed the SDK into the root `package.json` — for the most common real-world layout there is. It already walked *up* the tree for the lockfile; it now walks *down* into `apps/*` and `packages/*`, wires a single app silently, and lists the candidates rather than guessing when there are several.
- **Detection was stack-blind** (`@reticlehq/server`). It keyed on "vite is in package.json" and never looked at what the app renders with, so a Vue or Preact app got `@reticlehq/react` installed and an all-green report — a support claim nothing backs. The UI library is now detected and a non-React app is marked UNVERIFIED, saying which parts work (DOM, network, console, state) and which do not (component names, `file:line`).
- **The Cursor rule was written into every project** (`@reticlehq/server`) because `~/.cursor` existed on the machine, so Claude Code users found an unexplained `.cursor/rules/reticle.mdc` in their repo. It is a project file now, written only when the repo has a `.cursor/` dir or Cursor is the only agent found. Global MCP registration is unchanged.
- **`SKILL.md` asked five questions before doing anything** — framework, package manager, dev-server port, existing testids, which AI tool — and buried `reticle init` as a blockquote *inside* step 1, after them. An agent reading it top-to-bottom did the four-step manual path instead of the eight-second automatic one, and the people this is built for do not know the answers to the questions. Setup is now `npx @reticlehq/server init` with nothing asked; the manual sections are explicitly the fallback for lines the report marks `⚠`. The documented `.reticle.json` `framework` value was also `vite-react`, which nothing has ever emitted or consumed.

**The MCP proxy dropped the agent's tools mid-session** (`@reticlehq/server`). `startMcpProxy` called `process.exit(0)` the moment its SSE stream ended, even though the daemon stayed up (`status` reported a live pid throughout). The agent's sixteen `reticle_*` tools simply vanished — no message, no exit code, nothing to correlate — and no agent can restore them; only a human running `/mcp` can. Reported three times in one session, each costing a round-trip and each looking like it might be a symptom of whatever else was being debugged.

- The proxy now reconnects with backoff instead of exiting, and replays the client's `initialize` into the new session — the daemon builds a fresh `McpServer` per connection, so without the replay a reconnected session would reject every subsequent call. The replayed handshake is issued under a reserved id so its response is dropped rather than reaching the client as a duplicate JSON-RPC id.
- Drops, reconnects and give-ups are appended to `~/.reticle/mcp-proxy.log` with a reason. Proxy stderr goes wherever the agent host puts it, which is usually nowhere; this is somewhere an agent can go read.

### Added

**Three more state libraries Reticle can read** (#70, #71, first step of #76)

- **`recoilStore`** (`@reticlehq/browser`) — takes an atom map plus the transaction stream from a small bridge component, because Recoil has no enumerable registry of live atoms and no per-atom subscription outside React. Each atom comes back as `{ status, value, error }` rather than a bare value: calling `getValue()` on a pending async selector **throws the pending promise**, so a bare projection would lose the whole state read over one slow atom.
- **`svelteStore`** (`@reticlehq/browser`) — a Svelte store has no pull side at all, so this reads by subscribing, catching the synchronous first callback the store contract guarantees, and unsubscribing (what `svelte/store`'s own `get()` does). It holds no lasting subscription and needs no teardown, and it **swallows that first callback** on `subscribe` — forwarding it would emit a state change at registration for a change that never happened.
- **`piniaStore`** (`@reticlehq/browser`) — subscribes with `detached: true` and `flush: 'sync'`. Without `detached`, a store registered inside a component goes permanently silent after unmount: still readable, never emitting another diff, which reads exactly like an app that stopped changing.

**Redaction is configurable** (#74)

- `reticle.connect({ redact: { keys, allow } })`. `keys` adds to the rule (a string matches a key name exactly, case-insensitively; a RegExp is tested), `allow` exempts a key from the default rule and loses to `keys`. Additive only — there is no way to replace the default set. Exempting a key the default rule treats as a credential prints a one-time warning naming it.
- Literal `keys` strings **cross the bridge**, so the daemon redacts them on the driven path too, where request bodies are captured raw from the network stack and never pass through the SDK. RegExp entries and `allow` deliberately do not cross; both exclusions fail in the safe direction. See [docs/usage.md](docs/usage.md#extending-the-redaction-rules).
- With no `redact` option the behaviour is exactly what it was, pinned by a test that walks every credential name the rule catches and every false positive it was taught to allow.

**Svelte source mapping** (#75)

- `@reticlehq/vite-plugin` stamps `data-reticle-source` into `.svelte` single-file components, so a SvelteKit verdict finally carries the `file:line` the rest of the product leads with. `svelte` is not a dependency: the compiler is resolved lazily from your app and its absence is a no-op. A React-only build is unaffected, asserted by comparing the plugin's output against Babel run directly.
- `reticle init` now also patches `vite.config` for SvelteKit. It already installed `@reticlehq/vite-plugin` and never wired it in, so the plugin sat in `package.json` doing nothing.

**A guard for the invariant behind three past bugs** (#77)

- `scripts/check-lossy-transforms.mjs` (wired into `pnpm lint`) classifies every export of the read-path modules, so adding one fails the build until somebody says whether it can drop data and how it declares that. Conformance suites drive fixtures guaranteed to lose data. The guard proves itself with `--self-test`. Rule written down in [CONTRIBUTING.md](CONTRIBUTING.md).

### Fixed

- **`reticle_state` said "that key does not exist" when it meant "here are 50 of them"** (`@reticlehq/core`, found by #77's registry). A wrong `path` into a store with more than 50 keys returned a capped `availableKeys` with no marker, which reads as the strongest possible negative signal — when the key was simply number 51. The result now carries `totalKeys` beside the sample.
- **Source pointers contained backslashes on Windows** (`@reticlehq/babel-plugin`). `path.relative` returns the platform separator, so `data-reticle-source` stamped `src\Foo.tsx:42:8` — the headline `file:line`, in a form matching neither the paths every other Reticle surface emits nor the ones an agent greps for. Nothing failed loudly. Both stampers now always emit forward slashes.

**Desktop on Windows was broken in three places, each silently** (#64). All three were found by building and running the Electron and Tauri smoke apps there for the first time.

- **`@reticlehq/core` shipped with no `dist/desktop-contract.cjs`.** The generator's CLI-entry guard compared `import.meta.url` against a hand-concatenated `file://${process.argv[1]}`, which never matches on Windows, so the generator ran as a no-op while `pnpm build` reported success. An Electron main process requires that file at boot, so **every Electron app built on Windows died at launch** with a module-not-found. The test that exists to catch this skipped whenever the output was absent — which cannot tell "nobody has built yet" from "the build produced nothing" — and so passed the whole time.
- **The bridge rejected every Tauri connection on Windows.** Tauri v2 serves `http://tauri.localhost` there rather than the opaque `tauri://localhost` used on macOS/Linux. Core's page-side `isLocalPage` knew that hostname; the bridge's WebSocket handshake check did not, so the app passed its own gate, dialed the bridge, and got 403 every time. The two halves of one rule had drifted. The bridge now applies `isLocalPage`; a lookalike hostname is still rejected.
- **The desktop battery could not run on Windows**, so none of the above was visible: the harness spawned `pnpm` (which is `pnpm.CMD` there), signalled POSIX process groups, looked for a binary without `.exe`, and matched only the macOS/Linux Tauri origin.

With these, `pnpm test:e2e:desktop` passes on Windows: Electron 20/20 and Tauri 14/14 — **including the native WebView2 capture path**, which v2.3.0 shipped as a documented Known Limitation ("compiles and is type-checked … but has never been executed on Windows; treat a green from it as unconfirmed"). It has now been executed: a real PNG of a hidden window, `fullPage` refused rather than downgraded, three concurrent captures, and no temp file left behind.

## [2.3.0] — 2026-08-05

**Desktop release.** Electron and Tauri become supported surfaces with a committed test battery behind them, and CI compiles the Rust for the first time. Plus a feedback channel so an agent can report a bad verdict, telemetry rebuilt around outcomes rather than activity, and a round of false-green fixes. No breaking API changes; on-disk flow files stay version 1.

### Behaviour changes — read these before upgrading

Nine changes alter what an existing caller gets back. Most change RESULTS rather than names, so nothing fails to compile.

- **Unknown tool parameters are REFUSED, not ignored.** A misspelled parameter used to be dropped and answered with a well-formed negative that read as a fact about your app. It now fails with that tool's own valid example.
- **The bridge SAMPLES above its message-rate cap instead of disconnecting.** A burst used to close the socket permanently, leaving the app running and Reticle blind. Excess events are now dropped and reported as a `rate-limited` blind spot, so a verdict over a sampled window says `coverage: partial`. Raise `RETICLE_MAX_MESSAGES_PER_SECOND` for a busy app.
- **`reticle_project` and `reticle_domain` cap their output** at 25 by default, reporting `totalRuns` / `flowsTruncated`.
- **`reticle_network_mock` and `reticle_viewport` return `no-cdp-provider`**, not `no-visual-provider`. Update any gate on the old code.
- **`reticle_network { ok }` now filters.** It was accepted and ignored, so `{ ok: false }` returned calls that had SUCCEEDED.
- **Desktop visual baselines must be re-taken.** Reticle's own presenter panel and annotator button were composited into every desktop capture; they are now excluded.
- **A one-way Electron `ipcRenderer.send` appears in `reticle_network`**, where nothing appeared before. It carries `oneWay: true` and no `ok`/`status`, because the renderer cannot learn the outcome.
- **Every telemetry event was renamed and the per-tool-call event is gone.** Analytics event names only — nothing in the API changed.
- **`SKILL.md` no longer offers Vue, Svelte or SvelteKit, and now offers Astro.** The first three had no app and no CI gate behind them; if you picked one, pick "Plain HTML / vanilla" — the wiring is the same `connect()` call. Astro had an app and a gate all along and was never offered.

### Known limitation

`reticle-tauri`'s **Windows** capture path compiles and is type-checked against the real WebView2 API, but has never been executed on Windows. It ships labelled rather than withheld — treat a green from it as unconfirmed.

### Added

**Desktop — Electron and Tauri** (#64)

- A desktop app connects to the bridge like any other app; one-line setup via `reticle({ desktop: true })` in the Vite plugin.
- `@reticlehq/electron` — the preload and main-process helpers as a real package rather than files bolted onto the SDK.
- `reticle-tauri` — screenshots and headless mode from two lines in `main.rs`, nothing on the JavaScript side.
- **IPC observer:** Electron and Tauri backend calls are no longer a blind spot — they appear in `reticle_network` as `ipc://<channel>`.
- Screenshots on Electron via `installReticleCapture(win)`; `{ fullPage: true }` is honoured where possible and REFUSED where not, never silently downgraded.
- `{ kind: 'net', ok: false }` asserts on the OUTCOME rather than on a status Reticle invented for IPC.
- `reticle doctor` diagnoses desktop misconfiguration — every failure it catches is otherwise silent.
- The desktop string contract is generated, so drift is impossible rather than merely tested, with a fast-gate guard.
- A committed desktop battery (`pnpm test:e2e:desktop`) driving a real Electron main process and a packaged Tauri binary, plus CI jobs that compile the Rust on Linux, Windows (cross-check) and macOS.

**Verification**

- `reticle_verify_change` — "did my change break anything" in one call, instead of four.
- `verified` + `because` — one field to gate on instead of eight to interpret.
- Contradictions arrive WITH the action, not only when asked for.
- The contradiction hunter reports cross-channel disagreement as a finding; `failure-misattributed` catches a 5xx the app blamed on the user.
- Failure acknowledgement no longer depends on reading English.
- `reticle_coverage` — which controls you drove and which you never touched. `reticle_affected` — which saved flows a diff invalidates.
- `reticle_inspect` joins the default tool surface; every tool now advertises a concrete example call.
- `reticle hunt <dir>` — the arithmetic behind the core claim.
- Reticle now sees files your app GENERATES (a CSV export never crosses the network).
- A command timeout now says what to do about it.

**Telemetry and feedback**

- A feedback channel: `reticle_feedback` for agents and `reticle feedback` for humans, so a bad verdict can be reported instead of silently worked around. Agents can request features, not only report failures, and self-report their model. `RETICLE_FEEDBACK=0` switches it off independently of anonymous counters.
- `bug_found` — the number that says whether Reticle WORKS rather than whether it is used, with `falseGreen` defined by presentation rather than by assertion. CI-found bugs are counted too.
- `verification_completed`, `project_profiled`, `runtime_crashed`, `version_changed`, `mcp_client_connected`, `init_completed` — outcomes and funnel, not activity.
- Tool usage is aggregated instead of streamed (~100× fewer events); every event carries a `sessionId`, an actor (human or agent), and a `projectId` hashed from the git origin so one repo counts once.
- Browser-leg latency, tool timing, machine state and connection FAILURES are measured; the in-page half reports its own failures without taking the SDK down.
- Redaction is derived from the input rather than from a list of field names, and error reports carry a fingerprint rather than anything anyone wrote.
- A telemetry CONTRACT enforced by a test, plus `telemetry-events-test` firing every event for real and checking it on the wire.
- `reticle identify` — opt-in, and the only way Reticle ever learns who you are.
- Reticle tells the agent when a new version exists.

**Fixtures and gates**

- `apps/atlas` — a fixture built to be hard rather than to be passed.
- Store adapters are tested against the real libraries instead of fakes of them.
- The SDK reports its rendering engine (`blink` / `gecko` / `webkit`).

### Fixed

**Verdict honesty**

- A structural blind spot no longer destroys the verdict it should merely qualify, and an unrecognised blind-spot kind no longer crashes the verdict path.
- A `202 Accepted` was counted as success, making every asynchronous workflow "verifiable" at the moment nothing had been decided.
- A click that did NOTHING was reported `verified: "yes"`; waiting for the page to settle was waiting for the evidence to disappear.
- `verified` degraded to `unknown` permanently after a single buffer eviction.
- `settled` was a false green on every streaming Suspense boundary.
- `VIRTUALIZED_UNMOUNTED` had a label and nothing ever emitted it.

**Observation**

- A text change was invisible — the most common thing an app does, unobserved.
- Request bodies were unreachable through the documented integration, and an absent body read as "there was none".
- `reticle_network { count: N }` silently meant "at least N"; `{ ok }` was documented but not implemented.
- The streamed-body watcher was gated on a content-type allowlist and threw unhandled rejections where `Response.body` is absent.
- The DOM observer referenced a global `Node` that is not guaranteed to exist; `jotaiStore` did not compile against a real Jotai store.
- A scoped state read no longer contradicts the unscoped one.
- `{ kind: 'route', contains }` matches the whole route, not just the pathname.

**Desktop** (#64)

- Tauri screenshots, headless mode and driving an occluded window all work — three documented "platform limits" that were not.
- Concurrent Electron screenshots all failed, blaming a helper that was installed; a destroyed requester could get a screenshot of a DIFFERENT window; captures could be saved truncated while reporting success; temp files accumulated.
- A missing preload line read as a clean, empty network view. A one-way `ipcRenderer.send` was completely unobserved. Tauri IPC on Windows was recorded as ordinary HTTP.
- The bridge crashed on a desktop webview's opaque Origin, and the SDK refused to start inside a desktop app.
- The Vite desktop injection could fail silently; `reticle doctor` no longer false-alarms on a bundled preload.
- The Electron preload supports multiple subscribers and a real unsubscribe.
- Both desktop demo apps joined the typecheck gate; the Tauri macOS liveness constraint is documented.

**Cost and discoverability**

- An unknown parameter was silently dropped and the reply looked like an ANSWER; a wrong-shaped call is now answered with a correct one.
- `reticle_project` returned the entire run history unbounded — 176 runs, ~5,000 tokens, in one call.
- The predicate field-grammar pointer was re-sent six times per turn; `reticle_observe` echoed the sessionId on every event; `reticle_state`'s example now teaches the cheap read.
- Lean tool descriptions were truncated inside "e.g."; ref lifetime is now stated; recovery hints no longer name tools nobody can call.
- `reticle_annotate` failed with a code and no way forward; `reticle_coverage` undercounted exactly the actions that WORKED.
- The `sessionId` guidance made a working default look unsafe.

**Infrastructure**

- A session the bridge hung up on now explains itself, and `RETICLE_MAX_MESSAGES_PER_SECOND` raises the cap.
- `@reticlehq/core`'s `prepack` did not generate the desktop contract it exports.
- A failed suite could produce a JUnit report CI read as zero tests.
- `@reticlehq/protocol` is gone from the tree.

**Contributed**

- `withFileLock` reclaims a path's chain entry once it settles, guarded by pointer identity so a queued successor is never dropped. Thanks @DevChiniwala. (#63)
- A bridge outage no longer opens a silent hole in the ledger — a full offline queue discarded events without declaring the drop. Thanks @hardikguptaofficialgit. (#66)
- `spawnDaemon` is injectable, and its fd-leak regression guard is no longer a false green. Thanks @DevChiniwala. (#78)
- `redactUrl` no longer rewrites a query string it did not redact. Thanks @DevChiniwala. (#79)
- A failed suite's JUnit output strips XML-illegal control characters. Thanks @DevChiniwala. (#80)
- `registerStore` no longer accepts a store it can never read — `subscribe` without `getState`. Thanks @DevChiniwala. (#82)
- `selectPath` / `capDepth` understand `Date`, `Map` and `Set`. Thanks @DevChiniwala. (#83)

### Security

- **A presigned S3/GCS URL was recorded verbatim.** A presigned URL is a bearer credential, and `X-Amz-Signature`, `X-Amz-Credential` (which carries the access key id) and `X-Goog-Signature` all passed through unredacted into the agent transcript, the session journal and any recorded flow — a file users commit. Now redacted, boundary-anchored so ordinary fields like `signatureVersion` stay visible, and the non-secret parameters an agent needs for context are deliberately preserved. Thanks @DevChiniwala. (#81)

## [2.2.1] — 2026-07-29

Patch release: anonymous, opt-out adoption telemetry — built transparent-first (a complete public policy, a one-line first-run notice, and a persistent `reticle telemetry disable`) — plus two contributed daemon/SDK fixes. No breaking changes; on-disk flow files stay version 1.

### Added

- **Anonymous usage telemetry (opt-out).** The CLI reports adoption events only — `install` (first run), `invoke`, `session_start`/`session_end` (with duration), and per-tool usage — keyed by a locally minted random UUID and a one-way hash of the project path. No code, no PII, no app data: nothing from the app under test ever leaves the machine. Sends are best-effort and non-blocking (a lost metric never touches a verification), quick CLI commands hand the send to a detached child so they exit at full speed, and ingestion is personless (no person profiles are ever created). Disabled automatically under vitest and in the e2e battery, so test runs never count as users. (`@reticlehq/server`, `@reticlehq/core`)
- **`reticle telemetry [status|enable|disable]`.** `status` prints what's on, why, and where the policy lives; `disable` persists a machine-wide opt-out that survives shells and reboots. `RETICLE_TELEMETRY=0` and the cross-tool `DO_NOT_TRACK` convention are honored everywhere and take precedence. The complete disclosure — every field sent and every field that never is — lives at [`docs/telemetry.md`](docs/telemetry.md). (`@reticlehq/server`)

### Fixed

- **`spawnDaemon` no longer leaks a file descriptor or leaves a ghost daemon.** The parent's copy of the log fd is closed after `spawn` duplicates it into the child; a silent spawn failure (`child.pid === undefined`) returns `false` and unlinks the empty pidfile instead of reporting success, so discovery never sees a ghost and the next spawn can't hit `EEXIST`; and a synchronous `openSync`/`spawn` throw cleans up the lock fd + pidfile rather than leaving them behind. Thanks @DevChiniwala. (#58) (`@reticlehq/server`)
- **SDK-internal warnings no longer pollute the agent's `CONSOLE_WARN` stream.** After `installConsole` patches `console.warn` to observe the app, three SDK diagnostics were emitting spurious `CONSOLE_WARN` events into the observation stream, indistinguishable from the app's own warnings. They now call a native `console.warn` captured at module load, so they reach the developer console without entering the agent's event stream. Thanks @DevChiniwala. (#59) (`@reticlehq/browser`)

### Changed

- **The docs no longer claim "no telemetry."** The accurate promise — **no app data ever leaves your machine**, plus anonymous opt-out usage metrics — is now stated where users look (README, usage, enterprise FAQ, architecture) and detailed in [`docs/telemetry.md`](docs/telemetry.md).

## [2.2.0] — 2026-07-26

The causal-evidence release: every verdict now carries _why_, verification becomes part of "done", and the layer stops trusting evidence it doesn't have. Faster on long sessions and big DOMs, and the published packages are brought to OSS-library standard (licensing, packaging, CI security). No breaking changes — schema additions stay back-compatible and on-disk flow files remain version 1.

### Added

- **`reticle init` writes a verification rule into your coding agent's instruction file** (`CLAUDE.md` / `.cursor/rules/reticle.mdc` with `alwaysApply` / `AGENTS.md`), so the agent verifies a feature with Reticle _after building it_ — not only when you remember to ask. Idempotent and rides with the MCP registration. (`@reticlehq/server`)
- **Causal evidence on results:** a bounded causal summary on `reticle_act_and_wait` (net/console/state/storage/route/signals + settle time), a first-divergence capsule on a red result (the attributed chain effect→handlers→requests→state→DOM, with `file:line`), and a ranked deviation report as the default output after a replay. Blind-spot/coverage lines make partial visibility explicit rather than silent. (`@reticlehq/server`, `@reticlehq/browser`)
- **The verify loop:** `reticle affected <files>` maps changed files to the flows that cover them; `reticle gate` exits non-zero unless passing artifacts cover the affected, non-flaky flows — with anti-reward-hacking (a downgraded or deleted assertion on a changed file is a finding, not a silent pass); `reticle watch` reports affected flows on save. (`@reticlehq/server`)

### Security

- **Captured HTTP response/request headers are redacted before they reach the journal or the agent.** On the driven (CDP) path, `Set-Cookie`, `Cookie`, and `Authorization` were written to `.reticle/` in cleartext and streamed into the model's context; credential headers are now redacted by key and every other header value swept for known secret shapes, like request bodies already were. `cookie`/`set-cookie` joined the sensitive-key set (boundary-anchored, so app cookie names like `cookieConsent` stay visible). (`@reticlehq/server`, `@reticlehq/core`)
- **The enterprise license gate fails CLOSED in production.** A release with no resolvable issuer key (a mis-built build where the baked key was never stamped) previously ran every `ee/` feature FREE with no key and no warning; in production it now denies, and `reticle license` reports the build as MISCONFIGURED. Dev/eval still runs free so a contributor is never blocked. (`@reticlehq/server`)
- **Supply-chain / CI hardening:** Dependabot for npm + Actions, all GitHub Actions pinned to commit SHAs, least-privilege workflow tokens, a CodeQL scan, and the publish workflow now runs the full test gate and refuses to publish from any ref but `main` on a manual dispatch.

### Fixed

- **A run of false greens in the verifier's own trust plumbing** — the class the product exists to prevent. An `anyOf` predicate that greened via its presence branch no longer grades its honesty block as `signal`/`net` (a `minGrade` gate could have trusted a green that proved only presence); a flow's per-step signal can no longer be satisfied by an EARLIER flow's signal in a back-to-back suite; and six fields the handlers returned (`warning` on a throttled tab, the human-pause `guidance`, the RED `file:line` `source`, `window_ms`, a flow's `name`, capability `governance`) are no longer silently dropped by validating tool profiles. (`@reticlehq/server`)
- **Serialization / state-selection correctness:** an invalid `Date` in app state no longer crashes the whole state read (degrades to null); a truncated string or dropped object key is now reported instead of read as complete; a typed array serializes to an array, not an index-keyed object; `selectPath` no longer resolves prototype keys (`constructor`/`__proto__`) or non-canonical indices (`items.01`), and bounds its near-miss key list; `matchValue({})` no longer matches everything; and `settled`'s in-flight count is correct when a request id is reused. (`@reticlehq/browser`, `@reticlehq/core`, `@reticlehq/server`)
- **The ring buffer keeps a single event larger than its whole byte budget** instead of pushing then immediately self-evicting it (a waiter could never see it). (`@reticlehq/server`)
- **A second hardening pass closed more false-green and data-loss edges:** a scoped query/snapshot/assert whose scope has unmounted no longer silently widens to the whole page (a `scopeMissing` signal keeps "scope gone" distinct from "element absent", and an absence check is satisfied when the scope itself is the thing that vanished); the durable journal no longer drops an event when a read observes an in-flight append mid-line; parallel `reticle_flow_verify` no longer loses run-history or anti-gaming-baseline writes to a concurrent overwrite; the annotator's own "flag a bug" overlay no longer leaks into snapshots or the DOM/animation event streams; and the browser SDK's transport can no longer throw into the host app's bootstrap (mixed-content `WebSocket`) or reconnect-storm on a terminal `1008` close. (`@reticlehq/browser`, `@reticlehq/server`, `@reticlehq/core`)

### Changed

- **Long sessions and big DOMs are materially cheaper.** `reticle_observe`/`_network`/`_console` no longer re-read and re-parse the whole durable journal on every call once the ring buffer has evicted (a parsed-tail cache — measured ~1.5s CPU + ~300MB/call on a 1-hour session, now O(new events)); `reticle_network`/`_console` default their output to the most-recent 200 (with the total disclosed) so a flooded session can't return a million-token result; `waitForPredicate` skips the extra near-miss DOM scans on interim polls and paces rechecks so an event flood can't saturate the app's main thread; and the ref registry amortizes its eviction instead of a full sweep per mint on a 10k-element page. (`@reticlehq/server`, `@reticlehq/browser`)

### Packaging

- **`@reticlehq/core` is Apache-2.0** end to end (package.json, LICENSE, NOTICE, and the root license overview now agree) — it is the wire contract every embeddable SDK package depends on, so the "Apache-2.0, safe to embed" promise depends on it.
- **`@reticlehq/babel-plugin` is now CommonJS,** so a standard `babel.config.js` can `require()` it on any Node version (it previously threw `ERR_REQUIRE_ESM` on older Node).
- Every published package declares `engines` (`node >=20`); Apache `NOTICE` files now ship in their tarballs; `@reticlehq/server` ships the enterprise license alongside the FSL one; and `@reticlehq/test` gained a README (its npm page was blank).

## [2.1.0] — 2026-07-18

This release turns Reticle's eyes on the parts of a running app a screenshot fundamentally can't see — the **network tab, client-side storage, and web-perf** — and hardens credential redaction across all of it so none of that new visibility leaks a secret into the agent transcript. It also lands a round of verifier-honesty fixes and a performance pass on the event buffer. No breaking changes — every addition is back-compatible and on-disk flow files remain version 1.

### Added

- **Network observation.** The SDK now instruments `fetch` + `XMLHttpRequest` and emits per-request events: HTTP status, content-type, response size, and status text on every call; opt-in request/response **body capture** (dev-only, redacted, per-body capped so a large payload can't evict the behavioral timeline); and **SSE / WebSocket frame capture** for long-lived streams. Surfaced through `reticle_network`, so an agent can assert "the POST returned 201 with the new id" instead of inferring it from the DOM. (`@reticlehq/browser`, `@reticlehq/server`, `@reticlehq/core`)
- **Client storage & cookie observation.** `reticle_storage` reads `localStorage`, `sessionStorage`, and readable cookies (sensitive keys redacted, `httpOnly` cookies noted as unreadable) — the app's real persistence, for verifying "the token survived reload" or "logout cleared the session." (`@reticlehq/browser`, `@reticlehq/server`)
- **Web-perf metrics.** A `PerformanceObserver` reports Largest Contentful Paint, cumulative layout shift, and long tasks into the ring buffer, so an agent can assert "no layout shift on load" or "LCP under 2.5s" — signals a screenshot can't verify. (`@reticlehq/browser`, `@reticlehq/core`)
- **Snapshots pierce open shadow DOM and same-origin iframes,** so web-component and embedded-frame UIs are no longer invisible to `reticle_snapshot`. (`@reticlehq/browser`)
- **The browser ↔ server boundary is enforced at the import level** — a dev-only ESLint rule bans `node:*` imports in the DOM packages and `document`/`window` in the Node packages, so the DDD contract can't silently erode.

### Fixed

- **Credential redaction is hardened across every surface the new observers expose.** URLs redact sensitive query params, path-embedded single-use tokens (`/reset/<token>`), `#access_token=…` fragments (OAuth implicit flow), and `user:pass@host` userinfo; captured bodies redact sensitive keys in JSON, form-encoded, and plain-text shapes, plus high-confidence secret _values_ (JWTs, provider key prefixes) sitting under a benign key, and `Authorization: Bearer …` tokens. The shared sensitive-key set gained `sessionid`/`jwt`/`pwd`/`sid` (anchored, no substring false positives). (`@reticlehq/browser`, `@reticlehq/core`)
- **A reused `XMLHttpRequest` no longer emits duplicate, mislabeled network events** — the completion listener is attached once per instance and reads the request identity at fire time, instead of accumulating a stale closure per `send()`. (`@reticlehq/browser`)
- **Two false-green oracles fixed.** `settled` no longer reports quiet while requests are still in flight, and a `console.info` assertion no longer "verifies" a level the buffer never captured. (`@reticlehq/server`)
- **`reticle` self-update installs `@reticlehq/server`** (the CLI package), not the schema-only `@reticlehq/core`, and an `npx` rollback no longer rolls _forward_. (`@reticlehq/server`, `@reticlehq/core`)
- **The bridge refuses to start on a remote bind with no `allowedOrigins`** instead of exposing itself, and a protocol-version-mismatched `HELLO` gets a clear "upgrade `@reticlehq/browser`" message. (`@reticlehq/server`, `@reticlehq/core`, `@reticlehq/browser`)
- **`heal-verify` replays from the drifted step,** not the whole flow, so a heal proposal is checked against the step that actually moved. (`@reticlehq/server`)
- **`SnapshotCache` is a true LRU** (was FIFO, evicting the hottest entry), scoped state reads select before applying the transport cap, `costHint` counts real UTF-8 bytes (not UTF-16 code units), and the offline transport queue drops the _oldest_ event on overflow so the freshest state survives a reconnect. (`@reticlehq/server`, `@reticlehq/browser`)
- **Web-perf metric semantics corrected:** CLS is a running cumulative sum (not per-shift under a cumulative name), LCP surfaces only a new larger candidate, and every metric carries its own entry timestamp. (`@reticlehq/browser`, `@reticlehq/core`)

### Changed

- **The event buffer is materially faster under DOM/animation floods.** `RingBuffer` eviction advances a head index (amortized O(1)) instead of `shift()`-per-event (O(n)), and byte accounting is threaded from the bridge's parse boundary instead of re-serializing every event. (`@reticlehq/server`)
- **The snapshot walk resolves computed style once per node** instead of repeatedly, cutting the cost of a full-page snapshot on large DOMs. (`@reticlehq/browser`)
- **Predicate re-checks coalesce** — a single in-flight evaluation with a trailing recheck replaces redundant overlapping passes (the worst `wait_for` bottleneck), and the consequence-vs-presence classification is hoisted into `@reticlehq/core` as the single source both graders share. (`@reticlehq/server`, `@reticlehq/core`)
- **Internal hardening & tidy-up:** one shared element resolver across both replay engines, `heal-run` extracted from `flow-tools`, the example apps grouped under `apps/examples/`, a daemon `O_EXCL` spawn-lock that closes the pidfile orphan race (the "CLI can't stop the daemon by port" symptom), and the browser observers brought to full test coverage.

## [2.0.1] — 2026-07-17

A bug-fix release focused on the verifier's honesty (no more silent false negatives), flow ergonomics, and zero-config setup. No breaking changes — every schema addition stays back-compatible and on-disk flow files remain version 1.

### Fixed

- **The event buffer no longer answers a confident "no" after it dropped the evidence.** The ring buffer evicts events on an age/size cap; when it has, `reticle_observe` / `reticle_network` / `reticle_console` now carry a `buffer: { held, dropped, note }` block so a negative result is distinguishable from "the evidence expired" — the difference between an honest verifier and a silent false negative on a long rollout. Omitted entirely when nothing was dropped (an intact buffer stays token-flat). (#27) (`@reticlehq/server`, `@reticlehq/core`)
- **`reticle_domain` no longer reports a fully-tested app as untested.** `FlowStore.load()` with no `projectId` (the CLI/CI/`reticle_domain` caller) now scans the per-project subdirs like `list()` already did, instead of resolving only the flat path — so a project-scoped flow is loaded, not listed-then-silently-dropped (which reported `flowCount: 0` and every declared signal/testid as a gap). (#26) (`@reticlehq/server`)
- **A flow that starts on another page no longer drifts on step 1 with a mystifying "a step no longer matches."** The recorder now captures the journey's `startPath`; on replay, when the tab is on a different route, the decision's next action says "navigate there (`reticle_navigate`), then replay." (#23) (`@reticlehq/browser`, `@reticlehq/core`, `@reticlehq/server`)
- **The "no browser session connected" error names the real cause.** In a multi-repo / multi-agent setup the usual culprit is a port mismatch between the app's SDK and the daemon's `RETICLE_PORT`; the error now says so instead of only pointing at the SDK flag. (`@reticlehq/server`, `@reticlehq/core`)
- **Security hardening (dev-only, same-machine trust):** `VisualStore.baselinePath`/`diffPath` now reject a traversal name like their siblings, and a failed pairing-token auto-provision warns loudly that the bridge is running without auth instead of degrading silently. (`@reticlehq/server`)

### Added

- **Zero-config daemon discovery.** Each live daemon publishes a `~/.reticle/daemon-<port>.json` registry entry; the Vite plugin, absent an explicit port, connects to the daemon serving THIS project's id — no more hand-reconciling a port in the app config and the daemon's `RETICLE_PORT`. Falls back to the default when nothing matches; an explicit port still overrides. (#24) (`@reticlehq/core`, `@reticlehq/server`, `@reticlehq/vite-plugin`)
- **Prune saved flows.** `reticle_flow_delete` removes a renamed/obsolete flow so it stops lingering in the replay list (project-scoped like `reticle_flow_load`; `not_found` on an absent flow, never a silent no-op). (#25) (`@reticlehq/server`)

### Changed

- **The HUD composer is polished.** The multi-line input's default OS scrollbar is replaced with the thin styled one used elsewhere in the panel, content-box sizing no longer causes a height jump on the first keystroke, and the textarea gains an accessible name. (`@reticlehq/browser`)
- **One `bridgeWsUrl()` builder** in `@reticlehq/core` replaces the four hand-built `ws://…/reticle` strings across the SDK, the Vite/Next snippet generators, and the CLI — the wire string can no longer drift. (`@reticlehq/core`, `@reticlehq/browser`, `@reticlehq/server`, `@reticlehq/vite-plugin`)

## [2.0.0] — 2026-07-11

The single-install `@reticlehq/core` umbrella is retired in favour of **audience-scoped packages**. Each package now depends only on what it needs — `@reticlehq/core` sits at the bottom of the graph as the wire contract (constants + zod schemas, `zod` its only dependency), so the dev-only browser SDK never reaches your server and the Node bridge never reaches your bundle. The split is the one breaking change; the migration is a rename with no behaviour change. This release also folds in the security-hardening work from 1.3.x and adds collision-safe multi-app flow storage.

### Breaking Changes

- **The `@reticlehq/core` umbrella is split into scoped packages.** In v1 you installed one package and imported everything from it via `/server`, `/vite`, `/next`, … subpaths. In v2 you install the package for your role:

  | v1 (umbrella subpath)                            | v2 (install this)          |
  | ------------------------------------------------ | -------------------------- |
  | `@reticlehq/core` (the dev SDK + React adapter)  | `@reticlehq/react`         |
  | `@reticlehq/core/vite`                           | `@reticlehq/vite-plugin`   |
  | `@reticlehq/core/next`                           | `@reticlehq/next`          |
  | `@reticlehq/core/babel`                          | `@reticlehq/babel-plugin`  |
  | `@reticlehq/core/test`                           | `@reticlehq/test`          |
  | `@reticlehq/core/eslint`                         | `@reticlehq/eslint-plugin` |
  | `@reticlehq/core/server` (and the `reticle` CLI) | `@reticlehq/server`        |

  `@reticlehq/core` still exists but is now **only the wire contract** shared across browser ↔ bridge ↔ agent. `@reticlehq/protocol` is a thin deprecated alias re-exporting `@reticlehq/core` (pulled in automatically; import from `@reticlehq/core` in new code — the alias is removed in v3).

  **Migrate:**
  1. Replace the single install with the packages for your app: `npm i -D @reticlehq/react @reticlehq/vite-plugin` (or `@reticlehq/next` for Next.js). Your agent runs `@reticlehq/server`.
  2. Update imports: `@reticlehq/core` → `@reticlehq/react` for the SDK; `@reticlehq/core/vite` → `@reticlehq/vite-plugin`; `@reticlehq/core/next` → `@reticlehq/next`; `@reticlehq/core/test` → `@reticlehq/test`.
  3. Update your MCP client config: the `reticle` CLI now ships in `@reticlehq/server`, so the command becomes `npx @reticlehq/server mcp`. Recorded flows, baselines, `.reticle.json`, tool names, and env vars are unchanged.

### Added

- **Per-project flow storage — collision-safe on a shared daemon.** Saved flows live under `.reticle/flows/<projectId>/`, so one daemon can serve many apps at once without their flows colliding or bleeding across projects: a flow recorded against app A can no longer be listed, loaded, or replayed against app B. The HUD's replay list, `reticle_flow_list/load/replay/heal`, and cloud sync are all project-scoped. Legacy flat (untagged) flows keep loading as global until re-recorded. (#22) (`@reticlehq/server`, `@reticlehq/core`)
- **Cloud flow sync.** When logged in to Reticle Cloud (`RETICLE_CLOUD_URL` + `RETICLE_CLOUD_KEY`), a saved flow is mirrored to your team's regression suite — best-effort, so a sync failure never fails the local save. Off by default: nothing leaves the machine unless you opt in. (`@reticlehq/server`)
- **Upgrade-hint contract** for value-triggered cloud prompts — surfaced only when a capability is actually blocked, never as a nag, and silenceable with `RETICLE_NO_UPSELL`. (`@reticlehq/core`)
- **`reticle version`** (also `-v` / `--version`) prints the running build, so you can confirm which `npx`-resolved version is executing. (`@reticlehq/server`)

### Fixed

- **The SDK reconnects the bridge the instant a tab returns to the foreground.** Browsers throttle timers in a backgrounded tab, so after a bridge outage — a `reticle` restart, laptop sleep/wake, a network blip — the panel could sit on "ENDED" until a manual reload. It now self-heals on focus. (`@reticlehq/browser`)
- **The HUD replay-flow list is bounded and page-scoped.** A long list can no longer hide the log and message input, and it shows only flows that can start on the current page instead of every flow the daemon has seen. (#22) (`@reticlehq/browser`)

### Security

- Block DNS-rebinding attacks against the MCP/HTTP control plane. (#12) (`@reticlehq/server`)
- Redact typed secrets from recorded flow files. (#13) (`@reticlehq/browser`)
- Redact credential-bearing query parameters in the network observer. (#14) (`@reticlehq/browser`)
- Neutralize `cmd.exe` argument injection in the Windows browser launcher. (#15) (`@reticlehq/server`)
- Treat a missing WebSocket `Origin` as untrusted unless a pairing token is set. (#16) (`@reticlehq/server`)
- Bake the issuer public key and fail closed on the enterprise gate. (#17) (`@reticlehq/server`)
- Add a production runtime backstop so the dev-only SDK refuses to activate in a production build. (#18) (`@reticlehq/browser`)
- Auto-provision a pairing token so loopback origins must present a secret to connect. (#19) (`@reticlehq/server`)

## [1.3.1] — 2026-07-06

Bug-fix release. No breaking changes; drop-in over 1.3.0.

### Fixed

- **`reticle_sessions` now declares every field it returns** (`adapters`, `hasCapabilities`, `cleanup_suggestion`, `pendingMarks`, `review_suggestion`, and the input/lease fields). A strict MCP client validates tool output against the declared schema, so the previously-undeclared fields could trigger a hard validation error on the client side; they are now part of the contract. (`@reticlehq/server`)
- **The Reticle HUD no longer counts itself as an occluder** in `reticle_inspect` / `reticle_act` hit-tests. The dev-only presenter overlay could produce false-positive `occluded: true` readings for elements it visually covered; hit-testing now skips Reticle's own UI. (`@reticlehq/browser`)

### Changed

- HUD label capitalized to **Reticle** (was lowercase `reticle`). Display-only. (`@reticlehq/browser`)

## [1.3.0] — 2026-06-30

### Rebrand: Iris → Reticle (BREAKING)

The project is renamed from **Iris** to **Reticle**. This is a clean rename — no behavior changes — but every public identifier moves, so existing installs must migrate.

| What | Before | After |
| --- | --- | --- |
| Install | `iris` | `@reticlehq/core` |
| Scoped packages | `iris-*` | `@reticlehq/*` (e.g. `@reticlehq/protocol`, `@reticlehq/react`) |
| Subpath imports | `iris/server`, `/next`, `/babel`, `/vite`, `/eslint`, `/test` | `@reticlehq/core/server`, `…` |
| CLI binary | `iris` | `reticle` (`reticle init`, `reticle mcp`) |
| MCP server name | `iris` | `reticle` (update your `.mcp.json` / client config) |
| MCP tools | `iris_*` (e.g. `iris_observe`, `iris_assert`) | `reticle_*` (`reticle_observe`, `reticle_assert`) |
| Project config | `.iris.json` | `.reticle.json` |
| On-disk artifacts | `.iris/` (flows, runs, baselines, visual) | `.reticle/` |
| Env vars | `IRIS_*` (e.g. `IRIS_PORT`) | `RETICLE_*` (`RETICLE_PORT`) |
| DOM attributes | `data-iris-*` (e.g. `data-iris-source`) | `data-reticle-*` |
| Next.js wrapper | `withIris` | `withReticle` |

**Migrate:**

1. `npm rm iris && npm i -D @reticlehq/core` (swap any direct `iris-*` deps for `@reticlehq/*`).
2. Rename `.iris.json` → `.reticle.json` and the `.iris/` directory → `.reticle/` — recorded flows/baselines carry over unchanged.
3. Update your MCP client config: server key `iris` → `reticle`, command `npx @reticlehq/core mcp`, and any `IRIS_*` env vars → `RETICLE_*`. Agents calling tools by name move from `iris_*` to `reticle_*`.
4. Find/replace `withIris` → `withReticle` and any `iris` imports → `@reticlehq/core`.

## [1.2.0] — 2026-06-27

The multi-agent release. One Chromium now serves many agents at once — a leased browser pool gives each its own isolated context, and project-scoped session identity keeps several apps on one machine from cross-talking. Plus a polish pass: the benchmark suite runs unattended, CI stops going red on dependency advisories it can't control, the daemon-readiness window is tunable, and the docs + README are rewritten to lead with value. Measured: 16 flows across 8 contexts in 5.2s vs 35.4s serial — **6.78× faster**.

### Added

- **BrowserPool — one Chromium, N isolated leased contexts.** A fleet of agents shares one browser instead of launching one each. Leases carry a TTL + heartbeat with a reaper for orphans, `reticle_lease_acquire` waits for the tab to connect, and `reticle_sessions` shows `projectId` + `leased`.
- **Project-scoped session identity** (on by default). Sessions resolve against a stable build-stamped `projectId` (Next / HTML / `.reticle.json`, auto-stamped by the Vite plugin), so concurrent apps never steal each other's session.
- **SvelteKit support in `reticle init`** for projects the Vite plugin can't inject into.
- **Real-Chromium + multi-agent CI suites** — framework-connect tests (Vite/React, Next App Router, Remix, Astro), the browser-pool path, and single-page crash isolation.
- **`RETICLE_DAEMON_READY_TIMEOUT_MS`** — tune how long the MCP proxy waits for the daemon to become ready (default 10s) for slow machines / CI.

### Changed

- **Daemon resilience + per-page fault isolation.** One bad page can't sink the fleet: page faults are isolated, the pool enforces its cap under burst, aborted acquires clean up, and stale daemon pidfiles are reclaimed (no ghost ports).
- **Docs lead with value and read for everyone.** README rewritten — value-upfront hero, a "who you are → what you get" table (vibe coder / engineer / QA / founder), and a "How to use it" walkthrough. New [multi-agent testing guide](docs/multi-agent-testing.md); benchmark images + numbers refreshed; benchmark passes renamed to plain names (observation-cost / agent-loop / replay).
- **The benchmark self-boots.** `pnpm bench` now starts and tears down its own fixtures (demo + api) with env-tunable readiness (`BENCH_*`), so the suite runs unattended.
- **CI hardened against flaky reds.** The security-audit step is non-blocking (a new transitive advisory no longer fails an unrelated PR), the e2e job retries with cleanup, and pre-commit matches CI step order.

### Fixed

- **`@reticlehq/core/next` `withReticle` no longer crashes the host build** (a bundled `__require.resolve`).
- **`reticle init`** detects the monorepo package manager and gives correct guidance for non-Vite/Next apps (CRA / webpack).
- **Clearer edge errors** — an unopenable leased URL says why; the browser warns when the bridge is unreachable on first connect.
- **Skill & docs corrections** for the public integration path (MCP registration, `reticle init` flow, stale-`npx` cache as the main `-32000` cause).

### Removed

- **Unused public exports** — `ObserverType` / `UpdateStatus` (`@reticlehq/protocol`), `buildClock` (`@reticlehq/test`), and the test-only `RETICLE_VITE_PLUGIN_NAME` re-export from `@reticlehq/core/vite`. No real consumers.

## [1.0.0] — 2026-06-22

The 1.0 release. Reticle is stable, documented, and benchmarked end to end: every package is versioned `1.0.0` under the open-core license split, and the same verify loop that wins on a toy app stays the cheapest way to observe a real production dashboard.

The headline is the "lean responses" pass — same observations, fewer tokens. On the cross-tool detection benchmark Reticle's average observation cost drops 959 → 815 tokens with detection unchanged at 1.0 and zero false positives, lifting Verification Efficiency past the best external tool (12.27 vs 10.55) while remaining the only tool that catches every regression. Re-verifying a saved suite costs 47 tokens with no model and 0% flake, up to **2,574× cheaper** than re-driving it with an LLM.

### Added

- **Honest, reproducible benchmarks with a small-app vs real-app story.** A committed benchmark image set (re-run efficiency, the two-apps small-vs-real comparison, the per-tool cost on the real Reticle dashboard, and a capability matrix) rendered from a public source pipeline (`assets/benchmarks` + a shared design system), with the methodology written up in [`docs/benchmarks.md`](docs/benchmarks.md). On a real production dashboard Reticle observes a page for 1,023 tokens vs Chrome DevTools MCP's 1,357 and Playwright MCP's 2,193, and is the only tool that asserts success from the app's own signal.
- **Documentation set** — an [architecture overview](docs/architecture.md), the benchmarks explainer, an expanded [getting-started](docs/getting-started.md), and a Mintlify configuration so the docs publish as a site.
- **Open-source project hygiene** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates, plus contributor / stargazer / forker recognition in the README.

### Changed

- **`reticle_act` collapses a clean action to its consequence** — the effect block now omits fields at their uninformative default (an absent `dispatched`/`targetMatched`/`visible`/`enabled` means `true`; an absent `focusMoved`/`occludedBy` means `null`; an absent `occluded`/`scrolledIntoView`/ `valueChanged`/`defaultPrevented` means `false`), so a successful click returns just `domMutatedWithin` and any real signal still surfaces. No information is lost — absence always means the boring value.
- **MCP tool results serialize as compact JSON by default** — the agent-facing `text` content drops the two-space indentation (the typed `structuredContent` is unchanged), ~40% cheaper on the structured payloads that dominate. Set `RETICLE_ENCODING=pretty` for the previous indented form; `RETICLE_ENCODING=toon` remains the densest tabular encoding.
- **`reticle_act_and_wait` returns a reaction digest, not the full timeline** — `trace` is now `{ window_ms, summary }` (the counts that answer "what did the app do?") plus a `since` cursor; the full per-event timeline is one `reticle_observe { since }` away when the counts aren't enough. On a large DOM the dropped events array was the bulk of the loop cost — a verify loop on a 5,000-row grid falls from ~531 to ~279 tokens with the consequence still asserted from the `row:approved` signal.

### Fixed

- **Multiple apps on one machine no longer collide or orphan the daemon.** Several Next.js / React apps (or browser tabs) can run at once: the `@reticlehq/next` integration now defaults to a unique per-tab session id (`SESSION_AUTO`) instead of a shared constant, so two Next apps never silently evict each other. A bridge/daemon **port collision now fails fast with a clear error** instead of hanging forever and leaving an orphaned process — the `listen()` calls finally handle `EADDRINUSE`.
- **License files now carry a real copyright.** Filled the Apache-2.0 appendix in every SDK package license so no `[yyyy]` / `[name of copyright owner]` placeholders remain.

### Security

- **Daemon mode now enforces the documented auth contract.** `reticle serve` / the MCP daemon previously built its bridge without forwarding the pairing `token`, bind `host`, or origin allow-list, so `RETICLE_TOKEN` / `RETICLE_HOST` / `RETICLE_ALLOWED_ORIGINS` were silently ignored in daemon mode. They are now honored identically to the in-process path. (Residual risk was bounded — the daemon is loopback-pinned — but the advertised control is now actually enforced.)
- **Every security-critical environment variable is a single named constant** (`ReticleEnv` in `@reticlehq/protocol`). A typo in an inline `'RETICLE_TOKEN'` string could previously have disabled auth silently; the names now live in exactly one place.

## [0.9.0] — 2026-06-21

The "verify anywhere, ready for enterprises" release. One command verifies a running app from any pipeline — no MCP, no human — and enterprise features unlock with an offline license.

### Added

- **`reticle verify <url>`** — one-shot, non-MCP verification: drives the preview, replays the saved flows, prints a deterministic verdict, and exits non-zero on fail. The command CI and AI app-builder platforms call without speaking MCP — the same `ReticleVerificationRun` artifact the MCP and HTTP paths produce.
- **Drive a hosted preview** — for a non-localhost URL, Reticle re-invokes the page's `reticle.connect()` (allow-non-localhost + a one-shot pairing token) so a deployed preview pairs to the local bridge with no app redeploy; `reticle verify --storage-state <file>` replays a logged-in session past an auth wall.
- **Enterprise licensing** — `reticle license` shows activation status; offline Ed25519 keys (`RETICLE_LICENSE_KEY`) verify locally with **no phone-home**. Open-core split: Apache-2.0 SDK, FSL server/CLI, Reticle Enterprise License for `ee/` features.
- **Branded id types** — `RunId` is nominal end-to-end, so ids can't be confused with flow names.

### Changed

- **Hardened persistence + HTTP boundary** — atomic run writes, bounded `.reticle/runs` retention, verify-server request/timeout limits, a frozen contract-lock test, and path-traversal guards on read and write.

### Fixed

- Oracle-backed flows now report **high** confidence — the success consequence propagates into the verdict instead of reading as a smoke test.
- A localhost preview connects to the bridge without a token mismatch; hosted-preview origins are allow-listed.

## [0.8.0] — 2026-06-20

The "developers love it" release. 0.7.0 won the agent; 0.8.0 wins the human — the dev who watches the agent work, points at what's wrong, and trusts the green.

### Added

- **Human review marks — "annotate the bug where you see it"** (`packages/browser`, `packages/server`, `packages/protocol`). A dev-only **"Flag a bug"** button rides with the presenter: the human toggles it, clicks the element that looks wrong, types what's wrong, and Reticle drops a numbered pin + emits a `HUMAN_MARK`. The mark carries the element's re-resolvable anchor (the same durable address a recorded flow uses) **and the source `file:line`** — so the agent fixes the exact element and code, not a guess. The agent drains marks with the new **`reticle_review`** tool: each pending mark comes with a ready-to-act `fix` hint (`Open src/Checkout.tsx:42 and fix: <note>. Then reticle_review { resolve: m1 }`), reading never consumes a mark, and `resolve` retires it once fixed. Off the deterministic benchmark path (human-driven) — `pnpm bench` unchanged.
- **First-run readiness + loop intro — `reticle_wait_ready`** (`packages/server`). Call it right after init: it blocks until the app's SDK connects (returns instantly if a session already exists, so zero latency on the happy path and on the benchmark), or times out with a `recovery` hint. Smooths the most common first-5-minutes footgun — the agent's first real call racing the WebSocket connect. Its ready response also carries a one-line **`loop` guide** (look → act → observe → assert → regress, plus the human-flag → `reticle_review` loop), so a fresh agent learns how to drive Reticle on its first call without reading docs. Pure, injected clock/sleep; off the benchmark path.
- **Deterministic visual regression — `reticle_viewport`** (`packages/server`). Pin the driven page to a fixed viewport size (clamped to sane bounds) so a screenshot baseline is reproducible across machines — the last missing piece of CI-stable visual diffing, alongside the already-shipped `reticle_visual_diff` `masks` (neutralize volatile regions) and a frozen clock (`reticle_clock`). Drive-only, additive; off the benchmark path. Provider-driven and tested via a fake page like `reticle_network_mock`.
- **CDP network mock / intercept — `reticle_network_mock`** (`packages/server`). On a driven page (`reticle drive`), stub a request deterministically: return a `500`, force offline (abort), or delay a response — so "verify the app handles a failed payment" is one declared rule, no backend changes. The matcher is pure (first rule whose url-substring + optional method matches wins → fulfill/abort/continue) and the Playwright `page.route` wiring is driven in tests with a fake Page/Route. Needs a driven browser; returns a `recommendation` to `reticle drive` otherwise. Off the agent/benchmark path.
- **`reticle status` shows sessions + health at a glance** (`packages/server`). The daemon exposes a local `GET /status`; `reticle status` now reports each connected tab (url, throttled, stale, pending human marks) and the session count — not just "running: pid". The plan's "no more pkill in a README" daemon DX. Local-only, off the agent/benchmark path.
- **Actionable error recovery** (`packages/server`). Every tool error returned to the agent now carries a `recovery` hint when the failure is recognized — the no-session footgun, multiple/unknown sessions, a throttled tab, a missing baseline/recording, the pairing-token config — so the first 5 minutes never dead-end on "what do I do now?". Conservative: an unrecognized error gets no invented advice.
- **The panel always reflects the agent's real state — `reticle_yield`** (`packages/server`, `packages/browser`, `packages/protocol`). A human watching the browser must never see "live" when the agent has actually stopped. The agent signals its turn boundary with **`reticle_yield({ mode: "waiting" })`** (done responding, will resume on your next message) or **`{ mode: "ask", note }`** (blocked, needs your answer — the question shows on the panel); the session is revived automatically on the agent's next call. Taught as the mandatory last step in the session lease, the loop guide, and the skill — and it's **agent-independent** (Codex / OpenCode / Claude / Hermes). The panel renders each handback distinctly via a PRESENTER `tone`: waiting = calm teal ✋, ask = amber ❓ pulse, **agent crashed/disconnected** = amber ⚠ pulse, a clean end = calm green. When the last agent's MCP connection drops, the daemon ends every session and pushes the "switch to your terminal" notice (verified end-to-end through a SIGKILL-ed agent). Off the benchmark path.
- **Don't lose a panel prompt in the death-race** (`packages/server`, `packages/protocol`). If the human types a message into the panel at the exact moment the agent stops, it would land in a dead inbox; now both the agent-detach and idle paths fold any unread note into the end banner — quoted and labeled `Undelivered (paste into your terminal): "…"` — so the words are surfaced back, not silently dropped.
- **Replay a saved flow from the panel — no agent** (`packages/browser`, `packages/server`, `packages/protocol`). The daemon pushes the saved-flow names to the HUD on connect; the human clicks **▶** on a flow and it re-runs with no agent in the loop — the page animates via the normal replay path and the ✓ / ⚠ drift / ✗ verdict lands in the same activity log they watch the agent in. The dev plays the regression suite directly. Off the benchmark path (a panel-driven control, not a tool).

### Changed

- **Internal cohesion split** (no behavior change): `SessionManager` moved to its own `session-manager.ts`, and the on-disk-artifact constants to `flow-constants.ts`, bringing both parent files back under the 500-line cap. All public import paths unchanged (re-exported).

### Fixed

- **Panel composer is now multi-line** (`packages/browser`). The HUD message box was a single-line `<input>` that sent on any Enter; it's a `<textarea>` now — **Enter sends, Shift+Enter inserts a newline**, and it auto-grows to fit.
- **Flag mode keeps the right cursors** (`packages/browser`). In "Flag a bug" mode every element showed the crosshair, including the Flag button and its popover — which are clickable; they keep the pointer cursor now. And the hover outline that boxes the element under the cursor no longer snaps jumpily: it **waits for the cursor to rest (~130 ms), then glides into place on an ease** and fades in.

## [0.7.0] — 2026-06-20

The regression-testing release. Reticle's flow `success` is now a **declared, deterministic, post-settle consequence** over program truth — not just "the element is there" — and the same flow replays with no LLM, so a CI gate diffs the verdict exactly (0% flake) at a fraction of the tokens an LLM re-drive costs.

### Added

- **`state` predicate — assert store truth** (`packages/server`, `packages/protocol`). Assert a value inside a registered store the DOM never showed: `{ kind: "state", store?, path, equals? }`, with `equals` a literal or a `{ $gte | $contains | $length }` operator. Available in `reticle_assert`, `reticle_act_and_wait`, as a per-step `assert-state` invariant, and as a flow `success-state` golden end-condition. Catches a UI-vs-store **desync** and a dead-handler **green-but-wrong** regression that no DOM read can — the success oracle fails when the store didn't change, with no testid drift.
- **Flow consequence family — `net { count }`, `console { absent }`, `state { hold }`** (`packages/server`, `packages/protocol`). A flow's `success` (via `reticle_annotate success-state`) now compiles to a real predicate over more than presence: `net { count }` asserts a request fired EXACTLY N times (catches a **double-submit** / retry-storm a presence check passes); `console { absent }` asserts the action left a **clean console** (catches a silent `console.error`); `state { hold }` asserts an unrelated store path **did not move** (catches an action's unintended **blast-radius** side-effect). Cardinality/absence/invariant predicates are read **post-settle** so a wait-until-true check can't pass before the regression lands.
- **Design-token awareness in `reticle_inspect`** (`packages/server`, `packages/browser`). Inspect now reports theme compliance — `{ colorToken, backgroundToken, offTheme, tokenCount }` — so an off-palette color (a value no design token defines) is observable in one call, not just "a color rendered."
- **React render meter** (`packages/react`). `installRenderMeter()` augments the React DevTools hook to count commits and registers an `__reticle_renders` store; `reticle_state` reads the commit rate, so a **wasted-render storm** (re-renders with identical output → no DOM mutation) is visible where a screenshot/DOM tool sees an idle page. `getRenderStats()` / `resetRenderMeter()` exported; host-safe.
- **Component auto-anchors — address any element with zero hand-added testids** (`packages/browser`, `packages/server`). `reticle_query by:"component"` resolves elements by component identity / source location, and recorded flows synthesize a stable `component` anchor (fiber → component → `file:line`) when no `data-testid` resolves, instead of degrading the step.
- **`reticle_flow_verify` — one-call suite regression check** (`packages/server`). Re-verify a K-flow suite and get one consolidated verdict (passing counted, only failures detailed), so an agent's read-cost is roughly constant in suite size.
- **On-demand tool loading — `dynamic` / `hybrid` MCP profiles** (`packages/server`). Load tool schemas as needed instead of paying for the full set up front, cutting the agent's per-turn token floor.
- **Richer observation** (`packages/browser`, `packages/server`): a `net.pending` signal for in-flight / hung requests; generic-container text in the snapshot so a silent DOM removal is visible; a grid layout signature so a CLS/layout regression shows up.

### Changed

- **Leaner agent verify loop** (`packages/server`). Terser tool descriptions and compact `reticle_network` / `reticle_console` projections on the lean profiles roughly halve the per-turn token cost; `core` is the default profile tuned for the build-verify loop.

### Fixed

- **`reticle_visual_diff` returned a shape its schema rejected** (`packages/server`). The tool's `outputSchema` declared `{ ok, match, diffPct }` but the handler returned the diff engine's real shape (`{ matched, changedPixels, ratio, … }`) and never set `ok`, so every real diff failed MCP output validation. The schema now matches the handler (`ok` plus the real fields); dimension-mismatch returns `{ ok:false, reason }`.
- **`reticle_flow_save` / `reticle_save_recorded` output schemas didn't match their handlers** (`packages/server`), breaking those tools over MCP. Schemas corrected.
- **`reticle_state` output validation + path scoping** (`packages/server`, `packages/protocol`). `reticle_state` no longer fails output validation, and `path`/`depth` selection is applied **in-page before transport truncation**, so a scoped read of a large store is no longer truncated to the wrong fields.
- **Transport sanitizer no longer redacts design-token fields** (`packages/browser`). A broad `token` redaction rule was clobbering `colorToken` / `tokenCount`; it's now scoped to auth-credential patterns.

## [0.6.10] — 2026-06-18

### Added

- **Deterministic waiting — the `settled` predicate** (`packages/server`). A new predicate `{ kind: "settled", quietMs }` passes once network + structural-DOM activity has been quiet for `quietMs` (default 500ms); ambient `dom.text`/animation churn (count-ups, spinners) is ignored so an animated page can still settle. Usable in `reticle_wait_for` and `reticle_assert`, and composable inside `allOf` with the consequence you expect. Replaces fixed sleeps — the #1 cause of flaky agent tests.
- **`reticle_act_and_wait` auto-settle** (`packages/server`). Omit `until` and the tool waits for the page to settle instead of requiring a predicate — "act, then wait for quiet" is now a single zero-config call, the documented alternative to a sleep.
- **`reticle_query` token controls** (`packages/server`) — `limit` (cap returned descriptors; reports `total` + `truncated` so a trim is never silent) and `count_only` (return just the match count).
- **`reticle_network` / `reticle_console` token controls** (`packages/server`) — `limit` (keep the most recent N matches, reporting `total` + `droppedOldest`) and a `cost:{bytes,tokens}` hint, matching the other read tools so the agent can self-budget everywhere.
- **`reticle_domain` `mustHold` per flow** (`packages/server`) — each flow now reports the success consequence that must hold for it (signal name / net URL), so an agent can answer "what are the critical flows and what must hold for each?" from the domain model alone.

### Changed

- **Self-healing now verifies the consequence before persisting** (`packages/server`). `reticle_flow_heal` with `apply:true` re-replays the healed flow and re-asserts its success consequence; if a rebound locator resolves but the flow no longer satisfies its intent, the write is **refused** (`status:consequence_broken`, file untouched). It heals the locator, never the intent.

### Fixed

- **Browser observers fully restore patched globals on teardown** (`packages/browser`). The network, route, and console observers stored a bound copy and assigned it back on teardown, so `window.fetch` / `history.pushState` / `console.*` were never restored to their original identity. They now keep the true original for restore and a bound copy only for invocation.

## [0.5.0] — 2026-06-15

### Added

- **`reticle mcp` — smart proxy with auto-start** (`packages/server`). Run `reticle mcp --drive <url>` and you're done: it starts the daemon if one isn't running, waits for it to be ready, then bridges Claude Code's stdin/stdout to the daemon's SSE endpoint. Users no longer manage the daemon manually.
- **`reticle mcp --drive <url>` / `reticle serve --drive <url>`** — pass a URL and Reticle launches its own Playwright browser at that URL, giving the agent full autonomous control without relying on the user's open browser tab.
- **`reticle mcp --headed` / `--headed` flag** — opt in to a visible browser window so you can watch exactly what the agent is doing.
- **Three new update MCP tools** (`packages/server`):
  - `reticle_version_info` — returns the installed version, execution kind (npx / global / local), and whether a newer version is available on npm.
  - `reticle_apply_update` — upgrades Reticle in place; requires `confirm: true` to actually run.
  - `reticle_rollback` — downgrades to the previous version; requires `confirm: true`.
- **Presenter mode** (`packages/browser`, `packages/server`) — `reticle.connect({ present: true })` mounts a dev-only HUD overlay that the agent can control: `reticle_narrate` shows a caption, `reticle_highlight` draws a ring around any element. The HUD is excluded from snapshots and tree-shaken in production.
- **Unified `SKILL.md` at repo root** — a single skill file auto-detects mode: setup wizard on first run (no `.reticle.json`), live-app testing on every run after. Covers Claude Code, OpenCode, Codex CLI, Cursor, Windsurf, VS Code, and Zed MCP config formats.
- **`.reticle.json` project config** — written after first-run setup; persists `port`, `headed`, `framework`, and `harnesses` so subsequent runs need zero questions.
- **`dev:reticle` script** in `apps/demo` — second Vite dev server on port 4310, isolated from the user's normal dev port.

### Fixed

- **All-throttled session auto-selection** (`packages/server`). When every connected tab is hidden (e.g. user is in VS Code with Chrome on another desktop), `SessionManager.resolve()` now picks the session with the freshest heartbeat instead of throwing `"multiple sessions connected"`.
- **Presenter HUD shows on bridge connect** — the overlay now mounts as soon as the SDK connects to the bridge, not only after the first `reticle_narrate` call.
- **`reticle_narrate` MCP schema validation** — relaxed the output schema so the tool no longer rejects responses from narration calls.
- **`reticle_inspect` / `reticle_clock` output schemas** — relaxed to pass through extra fields instead of stripping them, fixing spurious validation errors.

---

## [0.4.0] — 2026-06-11

First public release. Reticle is the **proof layer for AI agents** — it verifies your running web app from the inside and returns a **verdict with evidence** instead of a screenshot.

### Added

- **The verify loop over MCP** — `look → act → observe → assert`. `reticle_assert` evaluates a structured predicate against the live app and returns `{ pass, evidence, failureReason? }`, typically in ~100 tokens.
- **Six reaction types in one assert** — network calls, DOM changes, SPA navigation, console & errors (including "no errors during this flow"), animations, and app **signals**.
- **App signals** — `reticle.signal()` lets your app emit the facts a screenshot can't see (the store committed, the webhook arrived); a bundled ESLint rule flags mutations that forgot to emit one.
- **Regression detection** — `reticle_baseline_save` + `reticle_diff` to catch silently removed elements or new console errors before they ship.
- **Source mapping** — DOM element → React component → `file:line`, on React 18/19 and Next.js (keeps SWC).
- **Autonomous crawler** (`reticle_crawl`) that clicks every reachable control and classifies what breaks.
- **Declarative spec runner** (`@reticlehq/core/test`) for signal-bound, headless verification specs.
- **The `reticle` CLI** — bridge + MCP server, plus `reticle drive` for a launched browser.
- **Single package, subpaths** — `@reticlehq/core` ships the browser SDK (`.`), the server (`./server`), the spec runner (`./test`), source mapping (`./next`, `./babel`), and the lint rule (`./eslint`) — one install.

### Notes

- **Dev-only and localhost-only by default**; observers are additive and reversible, and the SDK is tree-shaken out of production. No telemetry.
- **Token efficiency** — a full verify loop is ~100 tokens vs ~7,300 for a full-tree snapshot (~73× on the common loop; ~1.8× full-tree-vs-full-tree). See [`docs/token-efficiency.md`](docs/token-efficiency.md) for the methodology and honest caveats.

[1.0.0]: https://github.com/reticlehq/reticle/releases/tag/v1.0.0
[0.9.0]: https://github.com/reticlehq/reticle/releases/tag/v0.9.0
[0.8.0]: https://github.com/reticlehq/reticle/releases/tag/v0.8.0
[0.7.0]: https://github.com/reticlehq/reticle/releases/tag/v0.7.0
[0.6.10]: https://github.com/reticlehq/reticle/releases/tag/v0.6.10
[0.5.0]: https://github.com/reticlehq/reticle/releases/tag/v0.5.0
[0.4.0]: https://github.com/reticlehq/reticle/releases/tag/v0.4.0
