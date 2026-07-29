/**
 * Anonymous product telemetry — the wire contract for how the OSS `reticle` runtime reports ADOPTION
 * (not verification results) to Reticle Cloud: is it installed, how often is it invoked, how many
 * distinct machines/projects run it, when is it uninstalled. This is what turns "npm downloads" (which
 * an investor discounts) into DAU/WAU/MAU, active sessions, and retention.
 *
 * Privacy is structural, not a policy: the ONLY identifiers on the wire are a random per-machine UUID
 * (`anonymousId`, minted locally, never derived from anything personal) and a one-way HASH of the
 * project (`projectId`) — no repo name, no path, no email, no code. It is strictly opt-OUT (respects
 * `RETICLE_TELEMETRY=0` and the `DO_NOT_TRACK` convention) and best-effort (a failed send never touches
 * the tool's behaviour). Same conventions as the rest of core: enums are `as const` narrowed with
 * `z.nativeEnum`, timestamps are epoch-ms NUMBERS, no `any`.
 */
import { z } from 'zod';

/** Bump when the event shape changes so the cloud can reject/upgrade old senders. */
export const TELEMETRY_EVENT_VERSION = 1;

/** The lifecycle moments that answer the adoption questions. One event = one moment. */
export const TelemetryEventKind = {
  /** First-ever run on this machine (or a fresh `npm install`) — powers install count + new-user curve. */
  INSTALL: 'install',
  /** The CLI/MCP server was invoked — the raw "how many times it gets used" counter. */
  INVOKE: 'invoke',
  /** A daemon/MCP session came up — the numerator of "active sessions" + DAU/WAU/MAU. */
  SESSION_START: 'session_start',
  /** A session ended (carries its duration) — powers active-session-length + churn-within-session. */
  SESSION_END: 'session_end',
  /** `npm uninstall` / removal — the "when people uninstall it" signal investors asked for. */
  UNINSTALL: 'uninstall',
} as const;
export type TelemetryEventKind = (typeof TelemetryEventKind)[keyof typeof TelemetryEventKind];

/** Max events accepted in one batch POST — a spooled sender must never flood the ingest door. */
export const TELEMETRY_BATCH_LIMIT = 50;

/**
 * One anonymous telemetry event. `anonymousId` and the optional hashed `projectId` are the only
 * identifiers; everything else is a low-cardinality dimension for slicing the adoption metrics.
 */
export const TelemetryEventSchema = z.object({
  v: z.literal(TELEMETRY_EVENT_VERSION),
  /** Random UUID persisted at `~/.reticle/telemetry-id`. Distinct-count of this = users (DAU/WAU/MAU). */
  anonymousId: z.string().min(1).max(128),
  /** One-way hash of the git remote (or cwd) — counts DISTINCT PROJECTS without revealing any of them. */
  projectId: z.string().min(1).max(128).optional(),
  event: z.nativeEnum(TelemetryEventKind),
  /** Client epoch-ms when the event happened (the server also stamps its own receive time). */
  ts: z.number().int().nonnegative(),
  /** Reticle version emitting the event — lets us see adoption of new releases + version spread. */
  version: z.string().min(1).max(64),
  /** Runs inside CI? Separates real human DAU from pipeline traffic (both matter, differently). */
  ci: z.boolean(),
  /** `process.platform` (darwin/linux/win32) — OS mix, low cardinality, non-identifying. */
  os: z.string().min(1).max(32),
  /** Only on `session_end`: how long the session was active, in ms. */
  sessionMs: z.number().int().nonnegative().optional(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

/** The batch envelope the ingest door accepts. Capped so one caller can't push an unbounded array. */
export const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(TELEMETRY_BATCH_LIMIT),
});
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
