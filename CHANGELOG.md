# Changelog

All notable changes to the **`@reticlehq/*`** packages are documented here (each entry notes the package it affects). The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`verified` + `because` — one field to gate on, instead of eight to interpret.** An action result carried `dispatched`, `settled`, `ok`, `grade`, `attribution`, `coverage`, `integrity` and the assertion verdict, with no rule for combining them: driving this surface produced `settled:false, settleReason:"timeout"` on a fill with no way to tell whether that was a bug or noise. Every action now answers `yes` | `no` | `unknown` with one sentence of deciding evidence; the eight dimensions remain beneath it. Two properties are load-bearing. A CONTRADICTION OUTRANKS A PASSING ASSERTION — measured on the bench app, "Fetch with retry" reports `verified:"no"` while `verdict.pass` is true, which is the false green this project exists to catch, inverted at the one field an agent reads. And `unknown` never collapses into `no`: on the same page three controls report `unknown` because the capture was truncated, which tells an agent to look again rather than to go change code. (`@reticlehq/server`, `@reticlehq/core`)

- **Contradictions now arrive WITH the action, not only when asked for.** Cross-channel disagreement is the one finding a human structurally cannot make — they watch one channel, the screen, so a UI that advanced while its write failed looks like success to them and always will. But it only ran inside `reticle_observe`, which meant it was found only when the agent already suspected something and went looking, inverting the whole point: catching what nobody suspected. `reticle_act_and_wait` now carries `contradictions` (omitted when clean, so a healthy action pays nothing). Driving 18 controls of the bench app surfaced `ui-advanced-request-failed` on "Fetch with retry" **with `verdict.pass = true`** — every other signal said the action was fine. (`@reticlehq/server`)

- **Every tool now advertises a concrete example call.** A schema names the FIELDS; it does not say how they compose, and lean profiles keep only the first sentence of a description — so an agent reads "execute one action against a ref" and guesses `{ action, testid }`. That guess is rejected inside the MCP SDK's own validation, BEFORE Reticle's error handling runs, so the reply is a raw zod dump naming no field and showing no correct shape. Two such round trips cost more than the lean snapshot saves, which quietly refunded the whole token advantage. Examples are validated against their own inputSchema by a test, because a wrong example teaches the mistake with authority. (`@reticlehq/server`)
- **`reticle_inspect` is in the DEFAULT tool surface.** Mapping a DOM node to `src/App.tsx:104` is what turns a finding into an edit, and it is the one capability here with no substitute in any other verification tool — but it sat in `standard` while the default is `hybrid`, so an agent had to already know it existed and reach it through `reticle_run`. Observed over a full 43-tool drive: it never gets called. The measured floor that justifies a lean core was about CUTTING to 8 tools, not about holding at 12. (`@reticlehq/server`)
- **`reticle_coverage` — which controls you drove, and which you never touched.** Every other read answers a question the agent already thought to ask, which bounds verification by the agent's imagination. This answers the one question that says whether to STOP: `{ total, exercised, untouched:[{ref,label}] }`. Driven refs are recorded at the single command chokepoint, so `act_sequence` and flow replay count too, and they survive event-buffer eviction — otherwise "untouched" silently degrades into "recently untouched", which reads as thorough while meaning the opposite. Unadvertised (zero per-turn cost), reachable via `reticle_run`. (`@reticlehq/server`)
- **`reticle_affected` — which saved flows a diff invalidates.** The logic existed as a CLI command, deliberately kept off the MCP surface because an advertised tool costs tokens every turn. That reasoning is right and is preserved (it is unadvertised, reached through `reticle_run`); what it missed is that the AGENT holds the diff and an MCP client may have no shell, so the party with the question could not reach the party with the index. (`@reticlehq/server`)

- **`{ kind: 'net', ok: false }` — assert on the OUTCOME, not on a status Reticle invented.** IPC has no status code; the 200/500 Reticle derives exists so the existing filters keep working, but making an agent write `status: 500` meant asserting on Reticle's own encoding rather than on the app's behaviour. `ok` is now a first-class net predicate: authoritative when the observer set it (IPC always does), falling back to the HTTP status so ordinary web requests need no change. (#64) (`@reticlehq/server`)

- **`@reticlehq/electron` — desktop is now a first-class adapter, not files bolted onto the SDK.** The preload and main-process helpers were shipping as loose `.cjs` files inside `@reticlehq/browser`, which made desktop the only integration that was not a peer of `@reticlehq/react` and `@reticlehq/next`. They now live in their own package with `./preload` and `./main` entry points. Follows the repo's existing convention for a plain-CommonJS package (as `@reticlehq/next` does): no TypeScript gate scripts, and excluded from the ESLint config, because an Electron preload MUST be CJS — a sandboxed one cannot load ESM at all — so `no-require-imports` cannot apply to it. (#64) (`@reticlehq/electron`, `@reticlehq/browser`)
- **The desktop string contract is generated, so drift is impossible rather than merely tested.** Three strings (`__reticleIpc`, the capture channel, the capture-file prefix) were hand-copied across six files that cannot import each other — a CJS preload cannot load the ESM SDK, and the daemon shares no module graph with the renderer. They now have exactly one definition, in `@reticlehq/core`, and `scripts/gen-desktop-contract.mjs` emits `dist/desktop-contract.cjs` from it at build time — the same generate-from-source pattern core already uses for the wire JSON Schemas. The previous drift-guard test is replaced by tests that the generator is complete and the built output is current. (#64) (`@reticlehq/core`)

- **Electron and Tauri support.** A desktop app now connects to the bridge like any other app — you start it exactly as you always do (`npm run dev`, `electron .`, `cargo tauri dev`) and it dials out; there is no URL to open and no browser involved. Snapshot, query, act, observe, network, console, state, assert, flows, screenshots and visual diffs all work, headful or headless, on both runtimes — a 43-tool drive scores identically on each. See [`docs/desktop-apps.md`](docs/desktop-apps.md). (#64) (`@reticlehq/browser`, `@reticlehq/core`, `@reticlehq/server`)
- **IPC observer — a desktop app's backend calls are no longer a blind spot.** Electron and Tauri reach their backends over IPC, which `fetch`/`XHR` patching cannot see; every such call was invisible, so `reticle_network` reported nothing, `act_and_wait` had no in-flight request to settle on, and `assert { net }` was vacuously true — a false green by construction. IPC calls are now recorded as ordinary requests (`ipc://<channel>`, `initiator: "ipc"`), with a synthetic 200/500 status so the existing filters and net predicates keep working, plus `ok` and the error message the main process or Rust command actually returned. Neither runtime's IPC entry point can be monkey-patched from the page — Tauri defines `__TAURI_INTERNALS__.invoke` as `writable:false, configurable:false` and Electron's `contextBridge` object is deeply frozen — so each uses the seam that exists: a Tauri `invoke` already travels as a `fetch` to its `ipc://` protocol and is picked up there, including a translation of the `Tauri-Response` header (the transport answers HTTP 200 even when the Rust command returned `Err`, so an untranslated failure read as a success); Electron needs one line at the top of the preload, `require('@reticlehq/electron/preload')`. (#64) (`@reticlehq/browser`, `@reticlehq/core`)

- **Screenshots on Electron, via `@reticlehq/electron/main`.** One line in the main process (`installReticleCapture(win)`) makes `reticle_screenshot` and `reticle_visual_diff` work on a desktop app — no CDP flag, no extra packages, works on a packaged `file://` renderer. It uses `webContents.capturePage()`, which reads the window's own backing store. Capturing a screen region was built and then deliberately deleted: it photographs whatever is on top, so an app window behind the editor would have been saved as a visual baseline showing the editor — the exact false green Reticle exists to eliminate. Tauri gets the same capability from `reticle-tauri` — see below. (#64) (`@reticlehq/browser`, `@reticlehq/core`, `@reticlehq/server`)

- **Failure acknowledgement no longer depends on reading English.** The contradiction hunter decided whether an app had surfaced a failure by pattern-matching English words in its state, so a German or Japanese app that reported the failure perfectly well would have been accused of hiding it. It now checks a structural signal first: whether the app echoed the failed call's OWN error text into its state — evidence in any language that it knows the call failed. The lexical patterns remain as a fallback, and are documented as the soft edge they are. (`@reticlehq/server`)
- **`failure-misattributed` — the server broke and the app blamed the user.** A 5xx answered with "invalid credentials" / "not permitted" sends someone to fix something they cannot fix, while the real fault goes unreported. Found by pointing the hunter at a bug this work did not write (bench-app's `swallowed-500-login`, which forces `/api/login` to 500 while the app answers `auth:denied`). A 4xx is excluded: there, blaming the client is correct. (`@reticlehq/server`, `@reticlehq/core`)
- **A fast-gate guard for the desktop contract.** The desktop wiring is three strings hand-copied across five files that cannot import each other (a sandboxed CJS preload cannot load the ESM SDK; the daemon shares no module graph with the renderer). A rename in any one of them broke desktop silently while every test still passed — the same drift class that once left four e2e specs dead across a framework. The guard reads the files as text, asserts they still agree, and costs milliseconds. (`@reticlehq/server`)
- **The contradiction hunter — cross-channel disagreement, reported as a finding.** Every other check in Reticle reads ONE channel and asks "did something bad happen there?" (a console error, a 500, a control that did nothing) — a human can do that too, just slower. This asks a question a human structurally cannot: do the channels DISAGREE? A person watching an app has one channel open, the screen, so a UI that advanced while its write failed looks like success to them and always will. Five kinds ship, each a false green that passes CI today: `ui-advanced-request-failed`, `signal-contradicted` (the app fired its own success signal over a failed request), `response-ignored` (a write succeeded and nothing on the client moved), `duplicate-request` (double-submit), and `request-never-settled` (the UI moved on over an in-flight call, which is what makes a later `settled` assertion a false green). Surfaced in `reticle_observe` (omitted entirely when clean, so a healthy action costs zero tokens) and per-control in `reticle_crawl`, which makes an autonomous crawl of an unknown app a false-green hunt rather than an error-log scrape. Rules are narrowed to avoid crying wolf: the write-shaped ones ignore GETs, and the headline rule stays silent when the app recorded the failure in its own state — otherwise correct code that catches a rejection and renders "could not add" would be reported alongside code that swallowed it. (`@reticlehq/server`, `@reticlehq/core`)

- **`reticle doctor` now diagnoses desktop misconfiguration.** Every failure it catches is SILENT, which is why it exists: a Tauri app whose CSP does not allow the bridge WebSocket runs perfectly and simply never appears in `reticle status`, and an Electron app missing the preload line reports zero network activity forever — which reads as "this app makes no backend calls" rather than "you are blind to all of them". It checks the Tauri CSP against the port actually in use (not a hardcoded default), warns when a custom CSP dropped the `ipc:` source Tauri needs for `invoke` itself, and checks that an Electron preload requires the shim and the main process installs the capture helper. Each finding names the file, the consequence, and a copy-pasteable fix. A healthy desktop project gets an explicit ✓ rather than silence, because silence reads as "not checked". (#64) (`@reticlehq/server`)
- **One-line desktop setup: `reticle({ desktop: true })` in the Vite plugin.** A desktop renderer now wires up exactly like a web app instead of hand-writing `reticle.connect()`. The flag changes two things a web app must never get: the plugin also applies to `vite build` (a packaged renderer is a production build with no dev server, so the default `apply: 'serve'` dropped the plugin and shipped an app with no connect at all), and `connect()` gets `allowInProduction` because that renderer reports NODE_ENV=production. Web behaviour is untouched and covered by tests asserting no desktop keys leak into a normal connect. (#64) (`@reticlehq/vite-plugin`)

- **`{ fullPage: true }` on a desktop app is honoured where possible and REFUSED where not — never silently downgraded.** It used to fall through to the shell, which photographs the viewport, so a caller asking for the whole scroll height got an image without the content below the fold and banked it as a full-page baseline; every later diff of that baseline was green about a region it had never captured. Tauri on Linux now does a real full-document capture (WebKitGTK renders it offscreen — measured under `xvfb`: 800x400 viewport vs 800x2400 full page from the same window). macOS, Windows and Electron cannot, so they answer `full-page-unsupported` and write no baseline at all. (#64) (`reticle-tauri`, `@reticlehq/browser`, `@reticlehq/electron`, `@reticlehq/core`, `@reticlehq/server`)

- **`reticle-tauri` — screenshots and headless mode for a Tauri app.** Two lines in `main.rs` and nothing on the JavaScript side: `reticle_capture` calls `WKWebView.takeSnapshot`, and `on_page_load` hides the window under `RETICLE_HEADLESS=1`. Capture renders the webview rather than the screen, so — like Electron's `capturePage()` — it needs no screen-recording permission, cannot return another window's pixels, and is correct with nothing on screen. The SDK invokes the command through Tauri's own internals, because Tauri has no preload stage where a shim could be installed; an app with its own capture can still expose `window.__reticleIpc.capture()` and the SDK prefers it. Capture is implemented on all three desktop platforms, each through its own webview API — `WKWebView.takeSnapshot` (macOS), WebView2 `CapturePreview` (Windows), and `webkit_web_view_get_snapshot` (Linux/BSD) — all capturing the visible viewport so a baseline taken on one platform is comparable on another. The Windows and Linux paths are type-checked against their real targets (Linux natively in a container, since its build scripts cannot cross-compile) but have not been run on those platforms. (#64) (`reticle-tauri`, `@reticlehq/browser`, `@reticlehq/core`)

- **A command timeout now says what to DO about it.** `command 'snapshot' timed out after 8000ms` is eight seconds of silence followed by a fact with no cause, and on macOS the likeliest cause for a Tauri app is not a bug in the app at all — an occluded window, or one on another Space, has its WKWebView suspended by the OS. The message now adds that diagnosis and the fix (bring the window onto the active Space; `xvfb-run` on Linux CI). The advice is added, never substituted, and only for a runtime that can actually suffer it: Electron is immune, and blaming occlusion there would send someone to move a window that was never the problem. The SDK reports its runtime with PAGE_HEALTH, because a URL cannot tell a Tauri dev server from a plain localhost app. (#64) (`@reticlehq/server`, `@reticlehq/browser`)

### Fixed

- **The `sessionId` guidance made a working default look unsafe.** It read "omit when only ONE browser session is open", which is not how resolution works: the manager scopes to the active project, prefers the non-throttled tab, and refuses rather than guesses when genuinely ambiguous. Verified live — with three sessions connected (an app plus two pool leases) omitting `sessionId` resolves correctly. But that sentence sent the agent off to list and filter sessions by hand before nearly every call, roughly ten times in one session. A sentence that makes a working default look unsafe costs more than a missing feature does, and a test now pins that the condition cannot come back. (`@reticlehq/server`)

- **A wrong-shaped call is now answered with a correct one.** Argument-shape errors are the most common failure an agent hits here, and the one Reticle's otherwise-good recovery messages never saw: the MCP SDK validates and throws BEFORE the handler runs, so the reply was the validator's internal state — `{"code":"invalid_type","expected":"string","received":...}` — naming no field and showing no correct call. Two failed round trips guessing `reticle_act`'s shape were observed live, which costs more than the lean snapshot saves. The zod detail is kept (it names the offending field) and the tool's own validated example is appended, so the reply says both what was wrong and exactly what a correct call looks like. Because the fix wraps an SDK-internal method, the test drives a real client over an in-memory transport and asserts on the message an agent receives — verified to fail when the override is disabled, which a test of the wrapper in isolation would not have caught. (`@reticlehq/server`)

- **The remaining discovery gaps: cheap and bug-catching options the DEFAULT profile could not see.** Auditing every advertised parameter against what survives the first-sentence trim found four more capabilities documented only in prose the lean profiles discard — so the `full` profile knew and the default did not. Measured on the React bench app: `query { count_only: true }` returns 43 B where the same query returns 1,304 B (~30x), and `snapshot { mode: "interactive" }` returns 276 B against 909 B (~3x). Both are now named in the sentence that survives trimming. Separately, the three predicate options that catch a bug rather than confirm an expectation — `net.count` (double-submit), `console.absent` (the action worked but logged a caught error), `absent` (it should have disappeared) — sat behind a `reticle_tools` round trip, so only an agent that already suspected something found them; they are now advertised once per turn. Net surface cost 13,794 B → 14,122 B, essentially flat against the 14,104 B baseline, and a single `count_only` call repays four turns of the hint. A test pins each one against the ADVERTISED text, since the trim is exactly what hid them. (`@reticlehq/server`)

- **The predicate field-grammar pointer was re-sent six times per turn.** 211 B describing `{ kind, ...fields }` rode on six advertised tools — 1,266 B, 23% of all parameter prose. Every parameter KEEPS the kind list, because that is what an agent needs to write a predicate and making it look at a second tool's description to find it trades accuracy for bytes — the wrong direction here. Only the trailing "call `reticle_tools` for field details" sentence is stated once, since that part is pure navigation: 14,104 B → 13,794 B (~77 tok/turn), with every predicate parameter still usable on its own. A test asserts each one names its kinds and that none defers to another tool. The advertised config also moved behind one exported builder so its tests assert on the REAL advertised text — the earlier abbreviation guard read raw tool definitions, which are trimmed later, and would have passed with the bug fully present. (`@reticlehq/server`)

- **`reticle_state`'s example now teaches the cheap read.** Called bare on a real React app it returned 9,808 B (~2,450 tokens) — 93% of it one 40-item array nobody asked for — while `{ depth: 2 }` returns the same shape in 210 B, a 47x difference. The scoping already existed; nothing advertised it, so the first call an agent makes is the most expensive one available. Same class as `snapshot { diff: true }` (129 B vs 1,128 B): capability present, discovery absent. (`@reticlehq/server`)
- **The per-turn surface cost in `profiles.ts` was re-measured off the wire.** The file flagged its own figures as stale and it was right to: lean profiles are now much cheaper than recorded (core/hybrid ~3,526 tok/turn, not 6,479) because they drop the advertised outputSchema, while `full` is much more expensive (~26,265 tok/turn, not 20,441) because it still carries it. The lean-to-full gap is 7.4x, not the ~3x the old numbers implied. Also recorded where the remaining cost sits — inputSchema is 76% of the hybrid payload, half of that parameter prose — so the next saving is in parameter descriptions, not in dropping tools. (`@reticlehq/server`)

- **Lean tool descriptions were truncated inside "e.g."** The first-sentence trimmer split on the first `". "`, which every abbreviation satisfies, so `reticle_act`'s ref parameter reached the agent as "Element ref from reticle_snapshot or reticle_query (e.g." and stopped — losing the example AND the contract stated after it. It degraded only the DEFAULT profile, the one whose raw strings nobody reads. (`@reticlehq/server`)
- **The ref lifetime is now stated.** Nothing said how long `e42` stays valid, so the safe move was a defensive re-snapshot before every action — a token tax paid on every loop to buy back a guarantee that could be given in one sentence. It is: stable for the same element across snapshots and actions, and it stops resolving only once that element leaves the DOM. (`@reticlehq/server`)
- **`reticle_observe` no longer echoes the sessionId on every event.** The caller passes that id IN the request; repeating it per row is the request quoted back once per event. Measured on a live app it was 25% of a four-event payload and grows linearly — a fifty-event window spent ~2.5KB restating a fact the caller supplied. Together with omitting `visibleDialogs` when empty (a rule `reticle_act` already followed and snapshot did not), pure repetition was 23% of everything a driving agent received. (`@reticlehq/server`, `@reticlehq/browser`)
- **The dev-time injection warning was a false alarm.** In serve, the flag means "my transform ran this session", which is NOT "the app has no connect()": Vite serves an unchanged module straight from its transform cache, so a warm start left the flag false while the served entry demonstrably contained the injection — verified by fetching it from the dev server. It announced that the app "will never connect" when it was already connecting. Dev now reports the doubt and names the benign cause; `buildEnd` keeps the hard failure, where a build always runs every transform and the certainty is earned. (`@reticlehq/vite-plugin`)

- **`@reticlehq/protocol` is gone from the tree.** It was already `private` and unpublished, but the package still existed, still built, and the repo described it two contradictory ways at once — `MIGRATION.md` said it was removed while `CLAUDE.md` and `CONTRIBUTING.md` listed it as a live deprecated alias to remove in v3. Dead weight that every contributor had to read and decide about. Deleted, along with its project reference, its boundary-checker entry, and the stale claim in the enterprise README that the wire contract still lives there (it lives in `@reticlehq/core`). `MIGRATION.md` keeps its entry, because users on older versions still need the instructions. (`@reticlehq/protocol`)
- **A recovery hint that named a tool nobody can call.** `MISSING_RECORDING` told the agent to call `reticle_record_start` and `MISSING_BASELINE` named `reticle_baseline_list` — both folded into action-dispatched tools by the surface merge and no longer advertised. The one message whose entire job is "here is the way out" pointed at a door that is not there, and nothing caught it because hints are prose and prose is not type-checked. Both now name the advertised form, and a test asserts every `reticle_*` mentioned by any hint is still in the advertised surface. (`@reticlehq/server`)
- **`reticle_annotate` failed with a code and no way forward.** `annotate_no_recording` came back on every call in a fresh session — annotating requires a recording that nothing tells you to start — and the recovery hints only attach to THROWN messages, so a structured `{ ok: false }` got none. An agent hitting it simply stopped annotating. Both failure codes now carry `recovery`: how to start a recording, and the six valid annotation kinds. (`@reticlehq/server`, `@reticlehq/core`)
- **`reticle_network` now says its IPC status is derived.** The 200/500 on an `ipc://` record is Reticle's own encoding, and asserting on it means asserting on that encoding rather than on what the app did. Grading already warned after the fact; the tool description now says it at the point of use, so `ok` is what an agent reaches for first. (`@reticlehq/server`)

- **Tauri screenshots, headless mode, and driving an occluded window all work.** All three were documented as hard platform limits. They were one wrong diagnosis wearing three hats. Every experiment that "proved" macOS suspends an occluded WKWebView hid or moved the window from `setup` — that is, BEFORE the webview had ever been presented, and a webview that has never been presented never loads its page at all. The 8s timeouts were real; the cause was not. Re-measured against the live app, a loaded Tauri webview answers at full speed while minimized, app-hidden with Cmd-H, fully occluded, behind a fullscreen app on another Space, and with no window on screen — a full 43-tool drive passes in every one of those states. Headless is therefore just an ordering: show, load, then hide. The `alwaysOnTop` workaround built against the imagined problem has been deleted, and the command-timeout advice that told users to go move a window now names the real cause instead. Four experiments agreeing is not a controlled result when all four share a confound. (#64) (`@reticlehq/server`, `reticle-tauri`)

- **The desktop Vite injection is loud in dev as well as build.** `buildEnd` covered the dangerous case — a packaged binary shipping uninstrumented — but in dev a missed injection just meant no session ever appeared and nothing said why. Serving the HTML now arms a deferred check (the browser has to request the entry first, so an immediate assert would fire on every healthy start) which warns rather than throws, because a running dev server should report the fault, not die of it. Build and dev share one message so they cannot drift. (#64) (`@reticlehq/vite-plugin`)
- **`reticle doctor` verifies a BUNDLED preload from its build artifact.** Staying silent stopped the false alarm but left the recommended setup unverifiable. Bundling inlines the shim, and the shim carries the contract's own window global — finding it in the output proves the preload is wired even though the `require` was compiled away. A build output that lacks it is now a genuine finding rather than an unknown. (#64) (`@reticlehq/server`)
- **Asserting on a derived IPC status now returns `advice`.** The synthetic 200/500 remains for compatibility, so an agent can still write `status: 500` and have it pass — but a green verdict pinned to a status Reticle invented now carries a nudge toward `{ ok: false }`, which describes what the app did rather than how Reticle encoded it. Follows the same steer-don't-block pattern the presence-only advice already uses. (#64) (`@reticlehq/server`)
- **The desktop Vite injection can no longer fail silently.** If the HTML entry was never matched, nothing was injected and the packaged app shipped with no `connect()` in it — it looked wired and reported nothing. That happened twice while desktop mode was being built. Entry matching is now exact when Vite's resolved root is known (a suffix match alone would also hit `/other/src/main.tsx`), and `buildEnd` throws if injection never happened, so a build that cannot instrument fails loudly instead of producing a binary that lies. (#64) (`@reticlehq/vite-plugin`)
- **`reticle doctor` no longer reports a missing preload on a BUNDLED one.** electron-vite and Electron Forge inline the require and point `main` at a build directory, so there is no preload source to read — and that is the setup these docs recommend, because it keeps sandboxing on. The check now searches the usual source locations and stays silent when it cannot locate a preload at all, rather than telling someone who did the right thing to undo it. (#64) (`@reticlehq/server`)
- **The Electron preload supports multiple subscribers and a real unsubscribe.** A single sink slot meant a second `connect()` in the same renderer silently stole the first one's subscription, and SDK teardown was "overwrite with a no-op" rather than a removal — so tearing one session down stopped reporting for the other. Subscriptions are now keyed by a token (function identity does not survive `contextBridge`), and teardown removes only its own. (#64) (`@reticlehq/electron`, `@reticlehq/browser`)
- **Screenshot temp files no longer accumulate.** The daemon unlinks a capture after reading it, but only if it ever reads — a dead session, a timed-out command or a rejected path left a ~300KB PNG in the temp directory forever. The main process now sweeps its own earlier captures on each new one, bounding it to a single file with no timer to leak or exit handler to forget. (#64) (`@reticlehq/electron`)
- **Both desktop demo apps are in the typecheck gate.** They carried only `dev` scripts, so they could rot silently — the exact failure this repo has been burned by before. (#64) (`@reticlehq/electron-smoke`, `@reticlehq/tauri-smoke`)

- **Documented the Tauri macOS liveness constraint.** A Tauri app is only drivable while its window is on the ACTIVE Space and unoccluded — move Spaces or fullscreen your editor and WKWebView is suspended, so the session stays connected while every command times out at 8s. There is no `backgroundThrottling` switch of the kind Chromium gives Electron. Measured at the same moment with both windows off-screen: Electron returned a full snapshot, Tauri timed out. This is the one place desktop is genuinely not like React/Next, and `xvfb-run` on Linux CI is the configuration that avoids it entirely. (#64) (docs)

- **A desktop screenshot could be saved truncated while reporting success.** The capture crossed the bridge as a base64 string, and the SDK's transport sanitizer caps every string at `MAX_STRING_LENGTH` (64KB) — so any screenshot over ~48KB arrived clipped, was written to `.reticle/visual/<name>.png`, and answered `{ saved: true, path, bytes }`. The file had no `IEND` chunk and no decoder could read it; `reticle_visual_diff` then failed with a pngjs stream error instead of a verdict. Found by driving the real app through every tool. Two fixes: the Electron helper now writes the PNG to a temp file and returns its PATH (the daemon and the app always share a machine — the bridge is loopback — so nothing large needs to cross the event wire, and the path is validated to be inside the OS temp dir with Reticle's own prefix so the daemon cannot be pointed at an arbitrary file); and the server verifies a capture ends with `IEND` before saving, so an incomplete image fails loudly instead of banking a corrupt baseline a later diff will trust. A real capture is now ~324KB where the truncated one was 49KB. (#64) (`@reticlehq/browser`, `@reticlehq/server`)

- **`{ kind: 'route', contains }` now matches the whole route, not just the pathname.** A hash router keeps the entire route in the fragment, so `pathname` never moves — which made a `contains` route assertion permanently unsatisfiable for every HashRouter app. That is not a niche case: HashRouter is the standard router for a packaged Electron/Tauri renderer, because on `file://` an absolute `pushState` rewrites the URL to a file that does not exist. `contains` now matches `pathname + search + hash`; exact `pathname` matching is unchanged. (#64) (`@reticlehq/server`)
- **The bridge no longer crashes on a desktop webview's Origin.** A WebSocket handshake carrying an opaque origin — `tauri://localhost`, `app://.`, `file://` — reached `new URL('null')` inside the `verifyClient` handler and threw, an uncaught exception in the HTTP upgrade path. Opaque origins are now kept verbatim (so they can be allow-listed at all, which normalization previously made impossible) and, carrying no attributable host, are gated on the pairing token exactly as a missing `Origin` already was. (#64) (`@reticlehq/server`)
- **The SDK no longer refuses to start inside a desktop app.** The localhost gate exists to stop a remote website driving a developer's local bridge, but it read a `file://`, `tauri://` or `http://tauri.localhost` page as remote and blocked the connection outright. A local desktop webview is now recognized as local; a remote page reaching a loopback bridge is still blocked, and a remote _bridge_ still requires the explicit opt-in plus a token. (#64) (`@reticlehq/browser`, `@reticlehq/core`)
- **`reticle open` explains itself on desktop.** With no app connected it suggested passing a URL, which does not exist for an Electron or Tauri app; it now says to start the app normally and let it connect. Its reuse check also no longer treats two different desktop apps as the same app — both opaque origins compared equal. (#64) (`@reticlehq/server`)

- **`withFileLock` reclaims a path's chain entry once it settles,** guarded by pointer identity so a queued successor is never dropped — previously every unique file path locked in a long-running daemon occupied a Map slot forever. Thanks @DevChiniwala. (#63) (`@reticlehq/server`)

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
