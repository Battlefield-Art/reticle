import { z } from 'zod';
import {
  EventType,
  PerfMetric,
  BlindSpotKind,
  StreamTransport,
  StreamDirection,
  ScrollDirection,
  StorageArea,
} from './constants.js';
import { HumanControlDataSchema, HumanMarkDataSchema } from './messages.js';

/**
 * Per-event-type payload schemas — the typed replacement for the envelope's open `data` record.
 * The envelope (`ReticleEventSchema.data`) stays open on the wire so a richer SDK is never rejected
 * mid-upgrade; narrowing happens here, at the server's inbound boundary and wherever the journal reads
 * an event's fields. `parseEventPayload` is that boundary.
 *
 * Two fidelity tiers by design:
 * - **Precise + closed** for stable observers (dom/route/perf/anim/scroll/signal/health/...).
 * - **Precise on the load-bearing fields + `.passthrough`** for observers / will enrich
 * (network, console, error, state, storage) — today's fields are validated, tomorrow's added
 * fields (stack, TTFB, initiator, path diffs) pass through instead of failing closed. Each closes
 * fully as its observer is rewritten.
 */

const elementLabel = z.object({ role: z.string().optional(), name: z.string().optional() });

const netStreamSchema = z
  .object({
    transport: z.nativeEnum(StreamTransport),
    direction: z.nativeEnum(StreamDirection),
    url: z.string(),
  })
  .passthrough();

const netRequestSchema = z
  .object({
    id: z.string(),
    method: z.string(),
    url: z.string(),
    status: z.number(),
    ok: z.boolean(),
    durationMs: z.number(),
    initiator: z.string(),
  })
  .passthrough();

const consoleSchema = z.object({ message: z.string() }).passthrough();

/**
 * The registry. `satisfies Record<EventType,...>` makes a missing event type a *compile* error —
 * the wire can never carry a type without a payload contract.
 */
export const EVENT_PAYLOAD_SCHEMAS = {
  [EventType.DOM_ADDED]: elementLabel,
  [EventType.DOM_REMOVED]: elementLabel,
  [EventType.DOM_ATTR]: z
    .object({ attr: z.string(), value: z.string().optional(), old: z.string().optional() })
    .passthrough(),
  [EventType.DOM_TEXT]: z.object({ text: z.string(), old: z.string().optional() }),
  [EventType.NET_REQUEST]: netRequestSchema,
  [EventType.NET_PENDING]: z.object({
    id: z.string(),
    method: z.string(),
    url: z.string(),
    initiator: z.string(),
  }),
  [EventType.NET_STREAM]: netStreamSchema,
  [EventType.PERF]: z.object({
    metric: z.nativeEnum(PerfMetric),
    value: z.number(),
    at: z.number(),
  }),
  [EventType.ROUTE_CHANGE]: z.object({
    from: z.string(),
    to: z.string(),
    pathname: z.string(),
    search: z.string(),
    hash: z.string(),
  }),
  [EventType.CONSOLE_LOG]: consoleSchema,
  [EventType.CONSOLE_WARN]: consoleSchema,
  [EventType.CONSOLE_ERROR]: consoleSchema,
  [EventType.CONSOLE_INFO]: consoleSchema,
  [EventType.CONSOLE_DEBUG]: consoleSchema,
  [EventType.ERROR_UNCAUGHT]: z
    .object({
      message: z.string(),
      source: z.string().optional(),
      line: z.number().optional(),
      kind: z.string().optional(),
    })
    .passthrough(),
  [EventType.VISIBLE_SHOWN]: elementLabel,
  [EventType.ANIM_START]: z.object({ name: z.string() }),
  [EventType.ANIM_END]: z.object({ name: z.string() }),
  [EventType.SCROLL_POSITION]: z.object({
    x: z.number(),
    y: z.number(),
    percent: z.number(),
    direction: z.nativeEnum(ScrollDirection),
  }),
  [EventType.REVEAL_SHOWN]: elementLabel.passthrough(),
  [EventType.SIGNAL]: z.object({ name: z.string(), data: z.unknown().optional() }),
  [EventType.STATE_CHANGE]: z.object({ name: z.string(), value: z.unknown() }).passthrough(),
  [EventType.STORAGE_CHANGE]: z.object({
    area: z.nativeEnum(StorageArea),
    key: z.string(),
    old: z.string().optional(),
    new: z.string().optional(),
  }),
  [EventType.PAGE_HEALTH]: z
    .object({ hidden: z.boolean(), focused: z.boolean(), reason: z.string().optional() })
    .passthrough(),
  [EventType.RENDER_COMMIT]: z.object({ commits: z.number() }),
  [EventType.FOCUS_CHANGE]: z.object({
    to: z.string().optional(),
    from: z.string().optional(),
    toBody: z.boolean(),
  }),
  [EventType.FLOW_RECORDED]: z.object({ name: z.string(), flow: z.unknown() }),
  [EventType.TRANSPORT_OVERFLOW]: z.object({ dropped: z.number() }),
  [EventType.TRUNCATED]: z.object({ channel: z.string(), dropped: z.number() }),
  [EventType.BLIND_SPOT]: z.object({ kind: z.nativeEnum(BlindSpotKind), count: z.number() }),
  [EventType.NET_DETAIL]: z
    .object({
      url: z.string(),
      method: z.string().optional(),
      status: z.number(),
      headers: z.record(z.string()),
      resourceType: z.string().optional(),
    })
    .passthrough(),
  [EventType.HUMAN_CONTROL]: HumanControlDataSchema,
  [EventType.HUMAN_MARK]: HumanMarkDataSchema,
} satisfies Record<EventType, z.ZodTypeAny>;

/** Narrow an event's `data` against its type's payload schema. Unknown in, typed-or-error out. */
export function parseEventPayload(
  type: EventType,
  data: unknown,
): z.SafeParseReturnType<unknown, unknown> {
  return EVENT_PAYLOAD_SCHEMAS[type].safeParse(data);
}
