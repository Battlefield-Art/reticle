# First-drive / advertised-surface cost

The dominant standing cost of putting Reticle in front of an agent is not any single call — it is the
**advertised tool surface, re-sent to the model on every turn**. That number used to be quoted from memory
("~47–55k"). This measures it from the real tool definitions, so a surface change shows up as a number.

```bash
node bench/first-drive/measure.mjs   # deterministic, no agent/API cost
```

Requires the server built (`pnpm --filter @reticlehq/server build`) — it imports the real `TOOLS` and
`filterTools` from `packages/server/dist`.

## Measured (2026-07-21, o200k proxy tokens)

| profile | tools | tokens/turn | chars |
| --- | --- | --- | --- |
| core — the lean verify loop | 12 | 6,479 | 25,081 |
| standard — core + common extras | 40 | 13,951 | 54,630 |
| full — every tool advertised directly | 56 | 20,441 | 79,865 |
| **hybrid (DEFAULT)** — core + 2 meta* | 12 | **6,479** | 25,081 |

\* the 2 meta-tools (`reticle_tools`/`reticle_run`) are injected by the dynamic layer and are not in
`TOOLS`, so the hybrid row is the measured **floor** — the real figure is this plus their two small schemas.

**The default (hybrid) costs ~68% less per turn than advertising the full surface.** Total tools on the
surface: **56** (down from 59 — v2.2.0 retired `version_info`/`apply_update`/`rollback`).

## Why this matters

Tool schemas are re-sent every turn, so this is a *per-turn* tax multiplied by loop length — which is why
v2.2.0's surface shrink and the hybrid default are worth more than they look. It is also the honest
counterweight to the +2.7%/-24.8% loop delta in `../fix-loop/COST-DELTA.md`: richer per-act results cost a
little more per call, while a smaller advertised surface saves on every turn.
