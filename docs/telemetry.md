# Telemetry

Reticle collects a small amount of anonymous usage data to help us understand whether the tool is
useful — which commands people run, which tools agents actually use, and whether people keep using
Reticle after they try it. That's what this data is for, and all it is for: making the product better.

This page is the complete description of what is collected. If something is not listed here, it is
not sent.

## The short version

- **Anonymous.** We cannot tell who you are, and we do not try.
- **No code, no app data.** Nothing from the app under test — no DOM, no network traffic, no console
  output, no source, no file paths — ever leaves your machine.
- **Opt out any time**, permanently, with one command:

  ```bash
  reticle telemetry disable
  ```

## What is sent

Five kinds of events, each a single small JSON object:

| Event | When | Extra data |
| --- | --- | --- |
| `install` | The first time Reticle runs on a machine | — |
| `invoke` | A `reticle` command runs | — |
| `session_start` | The local daemon starts | — |
| `session_end` | The local daemon stops | Session duration in ms |
| `tool` | An agent calls a Reticle MCP tool | The tool name (e.g. `reticle_act`) |

Every event carries the same few fields:

| Field | What it is | What it is not |
| --- | --- | --- |
| `anonymousId` | A random UUID minted locally on first run, stored at `~/.reticle/telemetry-id` | Not derived from your name, email, hardware, or anything else about you |
| `projectId` | A one-way SHA-256 hash of the project directory path | Not reversible — we can count *distinct* projects, but not learn any project's name or location |
| `version` | The Reticle version running | — |
| `os` | The platform (`darwin` / `linux` / `win32`) | Not the OS version, hostname, or hardware |
| `ci` | Whether the run is inside CI | — |

There are no IP-based profiles, no cookies, no fingerprinting, and no person profiles: events are
processed in "personless" mode, so they are never joined into an identity.

## What is never sent

Your code. Your app's DOM, network requests or responses, console logs, application state, or
screenshots. File paths, project names, or git remotes. Your name, email, or any account identifier.
Environment variables. Anything typed into the app under test. Verification results.

## Where it goes

Events are sent over HTTPS to [PostHog](https://posthog.com) (US cloud), a product-analytics service
acting as our data processor, and are used only in aggregate (counts, retention curves, tool
popularity). We do not sell or share this data.

## Your choices

Telemetry is on by default and Reticle tells you so the first time it runs — once, in one line, with
a pointer to this page. To see the current state at any time:

```bash
reticle telemetry status
```

Three ways to opt out, in whatever form fits your setup:

| Method | Scope |
| --- | --- |
| `reticle telemetry disable` | This machine, permanently (until `reticle telemetry enable`) |
| `RETICLE_TELEMETRY=0` | Wherever the variable is set — handy for CI or a fleet-wide profile |
| `DO_NOT_TRACK=1` | The [cross-tool convention](https://consoledonottrack.com) — Reticle honors it |

Opting out changes nothing about how Reticle works. A failed or blocked telemetry send never
delays, alters, or fails a command either — sends are best-effort and asynchronous by design.

To also remove the locally stored random id, delete `~/.reticle/telemetry-id`.

## A note on data protection

The data described above is designed not to identify you: the only identifier is a locally minted
random UUID, the project reference is a one-way hash, and no personal data is collected. We collect
it on the basis of our legitimate interest in understanding and improving Reticle, we minimize what
is collected to the fields listed here, and we honor every opt-out signal above. If you believe
something in this design falls short of that intent, please open an issue — that is a bug, and we
will treat it as one.

Any change to what is collected will be listed on this page and called out in the release notes of
the version that introduces it.
