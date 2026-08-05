// First-drive / new-surface cost, TRACKED not assumed.
//
// The dominant cost of putting Reticle in front of an agent is not any single call: it is the ADVERTISED
// TOOL SURFACE, which is re-sent to the model on every turn. That number was previously quoted from
// memory ("~47-55k"); this measures it from the real tool definitions so a surface change shows up as a
// number instead of a vibe.
//
// Run: node bench/first-drive/measure.mjs   (deterministic, no agent/API cost)
// Requires the server built: pnpm --filter @reticlehq/server build

import { TOOLS } from '../../packages/server/dist/tools/tools.js';
import {
  filterTools,
  TOOL_PROFILE,
  CORE_TOOL_NAMES,
} from '../../packages/server/dist/tools/profiles.js';
import { measure } from '../harness/tokenizer.mjs';

/** What actually crosses to the model per turn: each tool's name + description + input schema. */
function advertisedPayload(tools) {
  return JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? {},
    })),
  );
}

const PROFILES = [
  [TOOL_PROFILE.CORE, 'core — the lean verify loop'],
  [TOOL_PROFILE.STANDARD, 'standard — core + common extras'],
  [TOOL_PROFILE.FULL, 'full — every tool advertised directly'],
];

const rows = [];
for (const [profile, label] of PROFILES) {
  const tools = filterTools(TOOLS, profile);
  const m = measure(advertisedPayload(tools));
  rows.push({
    profile,
    label,
    tools: tools.length,
    tokens: m.tokens_o200k ?? null,
    chars: m.chars,
  });
}

// hybrid/dynamic advertise only the 2 meta-tools directly (the rest are fetched on demand), so their
// per-turn floor is the core set + 2 rather than the whole surface.
const hybridTools = filterTools(TOOLS, TOOL_PROFILE.FULL).filter(
  (t) => CORE_TOOL_NAMES.has(t.name) || t.name === 'reticle_tools' || t.name === 'reticle_run',
);
const hybrid = measure(advertisedPayload(hybridTools));

console.log('\n=== First-drive / advertised-surface cost (per TURN, o200k proxy) ===\n');
console.log(
  `${'profile'.padEnd(34)} ${'tools'.padStart(5)} ${'tokens'.padStart(8)} ${'chars'.padStart(8)}`,
);
for (const r of rows) {
  console.log(
    `${r.label.padEnd(34)} ${String(r.tools).padStart(5)} ${String(r.tokens).padStart(8)} ${String(r.chars).padStart(8)}`,
  );
}
// The 2 meta-tools (reticle_tools / reticle_run) are injected by the dynamic layer, not present in
// TOOLS — so this is the measured FLOOR for hybrid; the real figure is this plus their two small schemas.
const metaFound = hybridTools.length - CORE_TOOL_NAMES.size;
console.log(
  `${'hybrid (DEFAULT) — core + 2 meta*'.padEnd(34)} ${String(hybridTools.length).padStart(5)} ${String(hybrid.tokens_o200k ?? 0).padStart(8)} ${String(hybrid.chars).padStart(8)}`,
);
if (metaFound < 2) {
  console.log(
    '  * meta-tools are injected by the dynamic layer (not in TOOLS); hybrid = this floor + 2 small schemas.',
  );
}

const full = rows.find((r) => r.profile === TOOL_PROFILE.FULL);
const saved = full?.tokens ? Math.round((1 - (hybrid.tokens_o200k ?? 0) / full.tokens) * 100) : 0;
console.log(
  `\nDefault (hybrid) costs ~${saved}% less per turn than advertising the full surface.` +
    `\nTotal tools on the surface: ${String(TOOLS.length)}.\n`,
);
