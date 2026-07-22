import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './tools.js';

/**
 * Every `reticle_*` tool an e2e spec calls must still exist on the surface.
 *
 * This exists because the opposite happened and nothing noticed. A consolidation merged 56 tools down
 * to 41 — `reticle_record_start`/`_stop` became `reticle_record { action }`, `reticle_end_session`
 * became `reticle_session { action: 'end' }`, `reticle_flow_list` became `reticle_flow { action }` —
 * and four specs kept calling the old names. They died on `TOOLS.find(...)` returning undefined,
 * taking flow record/replay, self-heal, run history and live control with them, across bench-app AND
 * next-smoke. That is a whole framework's worth of coverage, dark for an unknown number of commits.
 *
 * It went unnoticed because the e2e battery needs three servers and ~20 minutes, so it is not in
 * `test:unit` — which is what actually runs. The battery cannot move into the unit gate, but the
 * failure mode that killed it is a name lookup, and a name lookup is checkable in milliseconds.
 *
 * So this is deliberately NOT an e2e test. It is a static cross-check placed in the gate that runs,
 * because the pattern in this repo is unambiguous: every rule a machine enforces has held, and every
 * rule left to prose has been violated. A renamed tool now fails here, in a second, instead of
 * silently deleting a spec's coverage.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(HERE, '..', '..', '..', '..', 'apps', 'e2e', 'specs');

/** Tool names referenced as string literals in a spec, e.g. T('reticle_query', …). */
const TOOL_REF = /'(reticle_[a-z0-9_]+)'/g;

/**
 * Names a spec may reference despite being absent from the advertised surface, each with the reason.
 *
 * "Absent" is not the same as "gone", and conflating them cost me a wrong claim in three files: a tool
 * can be RETIRED — handler intact, deliberately unadvertised because something else covers it — and
 * reading only the missing name looks identical to a lost capability. Every entry here states which
 * it is, so the next reader does not have to re-derive it from tools.ts.
 */
const KNOWN_REMOVED = new Map<string, string>([
  [
    'reticle_run_record',
    'RETIRED from the surface, not removed: tools.ts RETIRED_FROM_SURFACE records that flow_replay already auto-records run outcomes, so a manual append was redundant. The handler still exists and works; it is simply not advertised. An earlier note here claimed the capability was lost — it was not, and the claim came from reading a missing tool name without checking the retirement list.',
  ],
]);

function specFiles(): string[] {
  return readdirSync(SPEC_DIR).filter((f) => f.endsWith('.mjs'));
}

describe('e2e specs do not reference tools that no longer exist', () => {
  const advertised = new Set(TOOLS.map((t) => t.name));

  it('finds spec files to check (a passing test over zero specs proves nothing)', () => {
    expect(specFiles().length).toBeGreaterThan(5);
  });

  for (const file of specFiles()) {
    it(`${file} calls only tools that are on the surface`, () => {
      const text = readFileSync(join(SPEC_DIR, file), 'utf8');
      const referenced = [...text.matchAll(TOOL_REF)].map((m) => m[1]);
      const missing = [...new Set(referenced)].filter(
        (n) => n !== undefined && !advertised.has(n) && !KNOWN_REMOVED.has(n),
      );
      expect(
        missing,
        `${file} references ${missing.join(', ')} — renamed or removed from the tool surface. ` +
          'Update the spec, or add the name to KNOWN_REMOVED with the reason if the capability is ' +
          'genuinely gone.',
      ).toEqual([]);
    });
  }

  it('every KNOWN_REMOVED entry is actually removed — stale exemptions rot', () => {
    for (const [name, why] of KNOWN_REMOVED) {
      expect(advertised.has(name), `${name} is back on the surface; drop its exemption (${why})`).toBe(
        false,
      );
    }
  });
});
