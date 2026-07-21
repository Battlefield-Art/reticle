import { z } from 'zod';
import { TRANSPORT_LIMITS } from './constants.js';

/**
 * The durable causal journal. Each session gets an append-only pair on disk:
 * `.reticle/sessions/<id>/events.jsonl` (one `ReticleEvent` per line — already seq/actionId-stamped
 * and browser-edge-redacted) and `actions.jsonl` (one JournalAction per line). The ring buffer becomes
 * a hot cache over this ledger, so evidence survives eviction. Local-only; JSONL is versioned per line
 * so a schema bump never orphans an old file.
 */

/** Per-record schema version. JSONL is line-addressable, so versioning rides each record, not a header. */
export const JOURNAL_FILE_VERSION = 1;

/**
 * An action entity — every act/navigate the server dispatches. `seqRange`/`tRange` are the window used
 * to attribute events to this action (`attribution:"window"`); `effect` is a bounded summary of what
 * the tool returned. Args are already edge-redacted by the browser before they reach here.
 */
export const JournalActionSchema = z.object({
  v: z.literal(JOURNAL_FILE_VERSION),
  /** The command correlation id (`c<n>`) — the natural, cross-side-stable action identity. */
  actionId: z.string().min(1).max(TRANSPORT_LIMITS.MAX_REF_LENGTH),
  /** The MCP tool / command name that drove it (e.g. "reticle_act"). */
  tool: z.string().min(1).max(TRANSPORT_LIMITS.MAX_COMMAND_NAME_LENGTH),
  /** Redacted invocation args. */
  args: z.record(z.unknown()).default({}),
  /** Bounded effect summary (settle glyph, target, etc.). Kept open; narrowed by the writer. */
  effect: z.unknown().optional(),
  /** Whether the page settled within budget after the action, when known. */
  settled: z.boolean().optional(),
  /** Time from dispatch to settle in ms, when known. */
  settledInMs: z.number().int().min(0).optional(),
  /** Inclusive seq range of events attributed to this action, when any were observed. */
  seqRange: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional(),
  /** Elapsed-ms window [dispatch, resolve] used for window attribution. */
  tRange: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }),
  /** Elapsed-ms timestamp the action was recorded at (clock injected by the writer). */
  at: z.number().int().min(0),
});
export type JournalAction = z.infer<typeof JournalActionSchema>;
