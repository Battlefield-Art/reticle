# What Reticle catches that a Playwright script does not

Generated from a measured run. Every row below is a bug where **Reticle caught it, the
Playwright script did not, and neither tool flagged the clean build**. Labels in the registry
are ignored here — only the run counts.

> **Read this with the caveat it deserves.** An earlier version of this suite scored six bugs
> as Reticle-only because the Playwright branch returned "not supported" while the APIs to
> catch them existed and simply were not called. Two of those six are now scored as parity.
> A moat claim is only as strong as the adversarial pass on the COMPETITOR's harness.

## Measured: 24 Reticle-only · 54 parity · 3 Playwright-only · 2 missed by both

### CRITICAL severity (17)

| bug | what breaks | why a script outside the page cannot see it |
|---|---|---|
| `state-desync` | the Deployments nav badge count agrees with the store (also shown as the toolbar "N of N") | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `mutation-leak` | generating a script does not corrupt the top deployment's internal build checksum (never rendered) | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `generate-blast-filter` | generating a script does not overwrite the top deployment's internal cost figure (never rendered) | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `generate-blast-selected` | generating a script does not mutate the selected-deployment id | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `generate-blast-drawer` | generating a script does not open the (off-screen) deployment drawer in state | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `nav-blast-prompt` | navigating to Diagnostics does not corrupt the top deployment's internal checksum (never rendered) | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `nav-blast-title` | navigating to Diagnostics does not corrupt the top deployment's internal cost figure (never rendered) | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `newdeploy-blast-kpi` | opening the new-deploy modal does not corrupt the top deployment's internal cost figure (never rendered) | the app's store is a JS object inside the page. Playwright can evaluate() into the page, but it has no idea which object is the store, what shape it has, or when it changed — the app has to tell someone. Reticle is told at registration. |
| `kpi-deploys-tamper` | an unrelated Compose action must not corrupt the top deployment's internal cost (1200) | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `kpi-success-tamper` | an unrelated Compose action must not corrupt the top deployment's internal checksum ("9a3f00") | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `kpi-p95-tamper` | an unrelated Compose action must not corrupt the second deployment's internal cost (1215) | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `kpi-services-tamper` | an unrelated Compose action must not corrupt the second deployment's internal checksum ("9a3f01") | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `create-wrong-author` | a created deployment records the correct internal checksum ("2328"), not a corrupted one | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `create-wrong-createdat` | a created deployment records the correct internal cost (0, not yet costed), not a bogus figure | the correct VALUE is only knowable from app state (a total, a checksum, a derived count). The DOM shows a rendered string; comparing it to truth requires reading truth. |
| `swallowed-500-generate` | the generate request actually succeeded (not a 500 the UI swallowed) | the fault is CLIENT-side — the app receives a 500 the wire never carried. A request/response observer sees the real 200 and nothing wrong. |
| `swallowed-500-login` | login actually succeeded (not a 500 the UI proceeded past) | the fault is CLIENT-side — the app receives a 500 the wire never carried. A request/response observer sees the real 200 and nothing wrong. |
| `wrong-content-type` | the generate endpoint answers JSON (not an HTML error page with a 200) | the fault is CLIENT-side — the app receives a 500 the wire never carried. A request/response observer sees the real 200 and nothing wrong. |

### HIGH severity (6)

| bug | what breaks | why a script outside the page cannot see it |
|---|---|---|
| `sse-silent-stop` | the build-log stream actually delivers frames, not just an open connection | SSE/WebSocket FRAMES delivered vs rendered. Playwright exposes WS frames (so those are scored as parity), but comparing frames received against DOM produced needs both halves at once. |
| `sse-malformed-frame` | every frame the stream delivers is actually rendered — none silently dropped | SSE/WebSocket FRAMES delivered vs rendered. Playwright exposes WS frames (so those are scored as parity), but comparing frames received against DOM produced needs both halves at once. |
| `signal-missing-generate` | generating a script announces compose:generated exactly once | a declared domain signal has no DOM representation at all. Nothing renders when it fails to fire. |
| `signal-missing-deploy` | creating a deployment announces deploy:created exactly once | a declared domain signal has no DOM representation at all. Nothing renders when it fails to fire. |
| `signal-double-fire` | one generate click announces compose:generated once, not twice | a declared domain signal has no DOM representation at all. Nothing renders when it fails to fire. |
| `signal-wrong-name` | the generate signal uses its declared name, not a typo | a declared domain signal has no DOM representation at all. Nothing renders when it fails to fire. |

### MEDIUM severity (1)

| bug | what breaks | why a script outside the page cannot see it |
|---|---|---|
| `iframe-stale-data` | the iframe panel shows the CURRENT deployment count, not a frozen one | content inside an open shadow root or a same-origin frame. Playwright pierces shadow roots in its locators, so most of this class is parity; only the store-vs-frame comparison is not. |

## Caught by Playwright, missed by Reticle

Published deliberately. A benchmark that never reports a loss is not measuring.

- `paint-filter` (low) — the page renders with the correct colors (no global hue-rotate paint regression)
  - reticle observed: reticle script has no pixel diff (inspect computed-styles unchanged)
  - **why we lose:** a paint-level regression leaves every COMPUTED style identical — a global CSS filter re-tints pixels without touching any property an in-page read can see. Only a screenshot is ground truth. This is a permanent limit of reading the program instead of the picture.
- `paint-invert` (low) — the page renders with the correct colors (no global invert paint regression)
  - reticle observed: reticle script has no pixel diff (inspect computed-styles unchanged)
  - **why we lose:** a paint-level regression leaves every COMPUTED style identical — a global CSS filter re-tints pixels without touching any property an in-page read can see. Only a screenshot is ground truth. This is a permanent limit of reading the program instead of the picture.
- `payload-missing-field` (critical) — the generate request actually sends the prompt (server must not silently default it)
  - reticle observed: requestBody present, contains 'prompt'=true
  - **why we lose:** Reticle reads `init.body` inside its own fetch wrapper, so it sees what the page HANDED to fetch, not what left the machine. Whoever patches fetch last is outermost, and that ordering is decided by app bootstrap, not by us — so an axios/Sentry/auth interceptor initialised after connect(), a service worker (which never produces a window.fetch frame at all), or sendBeacon can all rewrite a request invisibly. A CDP or proxy observer sees the wire and catches it. This is a real limit of in-page instrumentation, not a fixture artifact: the fix is wire-level capture on the drive path (read request.postData() in the CDP network-detail listener), which is bounded work but does not exist yet, and would not help attach-mode sessions at all.

## False-positive traps (not firing is the PASS)

Bug-shaped things that are not bugs: a live-updating timestamp, an infinite ambient
animation. A tool that flags these is unusable on a real app, so silence is the correct
result and these are excluded from every catch count above.

- `trap-timestamp-region` — a live-updating timestamp must not make a stable neighbour read as changed — **both held**
- `trap-ambient-animation` — an infinite ambient animation must not stop the page from settling — **both held**

## Missed by both

Neither tool caught these. They are open coverage gaps, not wins for anyone.

- `cls-late-banner` (low) — the page does not shove content down after it has settled (CLS under 0.1)
- `cls-imageless-jump` (low) — the KPI row renders at its final height (no reflow jump)

