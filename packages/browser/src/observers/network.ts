import {
  BlindSpotKind,
  EventType,
  REDACTED_VALUE,
  RETICLE_WS_PATH,
  StreamTransport,
  StreamDirection,
} from '@reticlehq/core';
import { isSensitiveKey } from '../security/serialization.js';
import { captureMethod } from '../patching/capture-method.js';
import type { Emit, Teardown } from './types.js';
import { isCapturableType, projectBody, withBodyDeadline } from './network-body.js';

/** Config for the network observer. Body capture is OFF by default and dev-only opt-in. */
export interface NetworkOptions {
  /** Capture request/response bodies (text-like content only, redacted, per-body capped). */
  captureBodies?: boolean;
}

/** The byte size of a binary frame (ArrayBuffer / Blob / typed-array view), or undefined if unknown. */
function binaryFrameBytes(data: unknown): number | undefined {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return undefined;
}

/** Project one SSE/WebSocket frame: byte size + shape; the (capped, redacted) payload only when body
 * capture is on and it is a string frame. Binary frames report their byte size, not just a bare type. */
function frameFields(data: unknown, captureBodies: boolean): Record<string, unknown> {
  if (typeof data !== 'string') {
    const bytes = binaryFrameBytes(data);
    return bytes === undefined
      ? { frameType: typeof data }
      : { frameType: 'binary', frameBytes: bytes };
  }
  const out: Record<string, unknown> = { frameBytes: data.length };
  if (captureBodies) {
    const { body, truncated } = projectBody(data, 'application/json');
    out['frame'] = body;
    if (truncated) out['frameTruncated'] = true;
  }
  return out;
}

/**
 * The request body for the transcript. Plain strings and URLSearchParams are captured (redacted, capped);
 * FormData/Blob/ArrayBuffer/stream aren't text so they get a `requestBodyType` marker (the agent still
 * learns a body existed) rather than being silently dropped. Shared by the fetch and XHR paths.
 */
function projectRequestBody(body: unknown, captureBodies: boolean): Record<string, unknown> {
  if (!captureBodies) return {};
  let text: string | undefined;
  let contentType = 'application/json';
  if (typeof body === 'string') {
    text = body;
  } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    text = body.toString();
    contentType = 'application/x-www-form-urlencoded';
  } else if (body !== undefined && body !== null) {
    const shape = (body as { constructor?: { name?: string } }).constructor?.name ?? typeof body;
    return { requestBodyType: shape };
  }
  if (text === undefined || text.length === 0) return {};
  const { body: out, truncated } = projectBody(text, contentType);
  return truncated ? { requestBody: out, requestBodyTruncated: true } : { requestBody: out };
}

/** A path segment name that is typically followed by a single-use secret token in the NEXT segment. */
const SENSITIVE_PATH_SEGMENT =
  /^(reset|verify|verification|confirm|activate|invite|magic|magiclink|token|key|oauth|unsubscribe|password)$/i;
/** Only mask a following segment that looks token-like — short ids/words (`reset/form`) are left alone. */
const PATH_TOKEN_MIN_LENGTH = 12;

/**
 * Redact credential-bearing values so they don't leak into the agent transcript / flow / run
 * artifacts: query params (`?access_token=…`, signed-URL keys) via the shared `isSensitiveKey` regex,
 * AND path-embedded tokens (`/reset/<token>`, `/invite/<token>`) that live in the path, not the query.
 * The hash is preserved and the URL is returned byte-for-byte when nothing matched.
 */
export function redactUrl(raw: string): string {
  const hashStart = raw.indexOf('#');
  const hash = hashStart === -1 ? '' : raw.slice(hashStart);
  const beforeHash = hashStart === -1 ? raw : raw.slice(0, hashStart);
  const queryStart = beforeHash.indexOf('?');
  const pathPart = queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart);
  const query = queryStart === -1 ? '' : beforeHash.slice(queryStart + 1);

  let changed = false;

  // Credentials in the authority (`scheme://user:pass@host`) never belong in a transcript.
  let authority = pathPart;
  const userinfo = /^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i.exec(pathPart);
  if (userinfo !== null) {
    authority = `${userinfo[1] ?? ''}${REDACTED_VALUE}@${pathPart.slice(userinfo[0].length)}`;
    changed = true;
  }

  let newQuery = query;
  if (query !== '') {
    const params = new URLSearchParams(query);
    for (const key of [...params.keys()]) {
      if (isSensitiveKey(key)) {
        params.set(key, REDACTED_VALUE);
        changed = true;
      }
    }
    newQuery = params.toString();
  }

  const segments = authority.split('/');
  for (let i = 0; i + 1 < segments.length; i++) {
    const name = segments[i];
    const next = segments[i + 1];
    if (
      name !== undefined &&
      next !== undefined &&
      next.length >= PATH_TOKEN_MIN_LENGTH &&
      SENSITIVE_PATH_SEGMENT.test(name)
    ) {
      segments[i + 1] = REDACTED_VALUE;
      changed = true;
    }
  }

  // OAuth implicit flow puts the access_token in the FRAGMENT (`#access_token=…`), and hash-routers carry
  // `?token=…` in the hash — redact sensitive params there too, leaving plain anchors (`#section`) alone.
  let newHash = hash;
  if (hash.length > 1) {
    newHash = hash.replace(/([A-Za-z0-9_.-]+)=([^&\s]+)/g, (m: string, key: string) =>
      isSensitiveKey(key) ? `${key}=${REDACTED_VALUE}` : m,
    );
    if (newHash !== hash) changed = true;
  }

  if (!changed) return raw;
  const queryOut = queryStart === -1 ? '' : `?${newQuery}`;
  return `${segments.join('/')}${queryOut}${newHash}`;
}

interface XhrMeta {
  id: string;
  method: string;
  url: string;
  start: number;
  rawUrl: string;
  initiatorStack?: string | undefined;
  reqBody?: Document | XMLHttpRequestBodyInit | null;
}

/**
 * Response metadata that needs no body capture: HTTP status text, content-type, and byte size (from
 * content-length when the server sent it). Lets an agent tell an HTML error page served as 200 from
 * real JSON, and spot empty/oversized responses. Fields are omitted when absent so a clean call stays
 * token-flat.
 */
function netResponseMeta(
  statusText: string,
  contentType: string | null,
  contentLength: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (statusText !== '') out['statusText'] = statusText;
  if (contentType !== null && contentType !== '') out['contentType'] = contentType;
  const size = contentLength !== null ? Number.parseInt(contentLength, 10) : Number.NaN;
  if (Number.isFinite(size)) out['responseSize'] = size;
  return out;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method !== undefined) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

/**
 * The first app-code frame that fired a request — the in-page answer to a CDP initiator, as file:line.
 * Captured from a fresh Error.stack at call time, skipping Reticle's own wrapper frames. Feeds the
 * causal chain (which code path made this request). Capped; undefined when no stack is available.
 * ponytail: one stack unwind per request — cheap next to fetch itself; revisit only if a profiler flags it.
 */
/** Frames to skip: Reticle's own wrappers + engine-internal frames with no app source location. */
const NON_APP_FRAME = /reticle|network\.ts|@reticlehq|<anonymous>|new Promise|node:internal/i;

/** Pure: the first real app-code frame in a stack string, capped. Exported for unit testing. */
export function firstAppFrame(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    if (NON_APP_FRAME.test(line)) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    return trimmed.slice(0, 300);
  }
  return undefined;
}

function initiatorFrame(): string | undefined {
  return firstAppFrame(new Error().stack);
}

/** The timing fields we lift from a resource entry — TTFB is the perf signal a duration alone hides. */
export interface NetTiming {
  ttfbMs?: number;
  transferSize?: number;
}

/**
 * Pure: derive TTFB + transfer size from a PerformanceResourceTiming entry. TTFB = responseStart -
 * requestStart; cross-origin responses zero those (Timing-Allow-Origin), so we omit rather than report a
 * bogus 0. Exported for unit testing (jsdom doesn't post real resource entries).
 */
export function extractTiming(entry: PerformanceResourceTiming | undefined): NetTiming {
  if (entry === undefined) return {};
  const timing: NetTiming = {};
  if (entry.responseStart > 0 && entry.requestStart > 0) {
    timing.ttfbMs = Math.round(entry.responseStart - entry.requestStart);
  }
  if (entry.transferSize > 0) timing.transferSize = entry.transferSize;
  return timing;
}

/** Best-effort lookup of the most-recent resource-timing entry for a URL. */
function resourceTiming(rawUrl: string): NetTiming {
  try {
    const entries = performance.getEntriesByName(rawUrl, 'resource');
    return extractTiming(entries[entries.length - 1] as PerformanceResourceTiming | undefined);
  } catch {
    return {};
  }
}

/** Patch fetch + XMLHttpRequest to emit net.request events. Fully reversible. */
/**
 * True for Reticle's OWN bridge connection, which must never be instrumented.
 *
 * The transport resolves `WebSocket` at call time, so a reconnect after instrumentation constructs a
 * PATCHED socket. From then on emitting an event calls transport.send -> the patched send emits a
 * NET_STREAM event -> which calls transport.send again, until the stack blows and the page is dead.
 * Keyed on the bridge PATH rather than the host: an app's own socket on the same origin must still be
 * observed, otherwise this guard would blind the stream category it exists to protect.
 */
function isBridgeSocket(url: string): boolean {
  try {
    return new URL(url, location.href).pathname === RETICLE_WS_PATH;
  } catch {
    return url.includes(RETICLE_WS_PATH);
  }
}

/**
 * Whether a function is the platform's own fetch rather than someone's wrapper.
 *
 * `Function.prototype.toString` on a built-in yields "[native code]"; a JS wrapper yields its source.
 * Called off the prototype deliberately, so a wrapper cannot hide behind its own `toString`.
 *
 * Two known limits, both stated in tests rather than left to be discovered:
 *   - a BOUND wrapper (`window.fetch = mine.bind(x)`) also reports "[native code]", so it is missed.
 *     Nothing in the platform separates the two.
 *   - a POLYFILLED fetch reads as wrapped and IS reported — correctly, since a polyfill is a layer we
 *     cannot see through, though it will look like a false positive to anyone triaging it.
 *
 * Both failure modes are safe: we under-report on the first and over-report on the second, and
 * over-reporting a coverage caveat is the direction this library errs in everywhere else.
 */
function isNativeFetch(fn: typeof window.fetch): boolean {
  try {
    return Function.prototype.toString.call(fn).includes('native code');
  } catch {
    return false;
  }
}

/** Wrappers this module installed, so a re-install does not report itself as a foreign wrapper. */
const OURS = new WeakSet<typeof window.fetch>();

export function installNetwork(emit: Emit, opts: NetworkOptions = {}): Teardown {
  const captureBodies = opts.captureBodies === true;
  // Keep the true original for teardown identity, plus a window-bound copy to invoke
  // (fetch throws "Illegal invocation" if called with the wrong `this`).
  const origFetch = window.fetch;
  const callFetch = origFetch.bind(window);

  // Declare it if we are not the first to wrap fetch.
  //
  // Wrappers chain outermost-first, and we record `init.body` when OUR wrapper runs — so anything
  // installed EARLIER sits below us and mutates the request after we have read it. That is a real
  // blind spot (an auth/analytics interceptor started before connect(), a polyfill, a service worker
  // is worse still) and it is not fixable from in here: there is no "patch last" primitive, and
  // racing for outermost loses to whatever loads after us.
  //
  // So it is reported rather than hidden, on the same contract as the cross-origin-iframe sensor —
  // say what we cannot see, so a green verdict never implies we saw it. `isOurs` keeps a re-install
  // from blaming the app for our own wrapper.
  if (!isNativeFetch(origFetch) && !OURS.has(origFetch)) {
    emit(EventType.BLIND_SPOT, { kind: BlindSpotKind.WRAPPED_NETWORK, count: 1 });
  }

  // Correlation id so a NET_PENDING (emitted at request START) can be matched to its
  // NET_REQUEST completion. A request that never completes leaves an unmatched NET_PENDING —
  // that is how a hung/in-flight request becomes observable (it never resolves, so the old
  // completion-only emit saw nothing).
  let seq = 0;
  const nextId = (): string => `n${++seq}`;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const id = nextId();
    const start = performance.now();
    const method = methodOf(input, init);
    const rawUrl = urlOf(input);
    const url = redactUrl(rawUrl);
    const initiatorStack = initiatorFrame();
    const initiatorFields = initiatorStack === undefined ? {} : { initiatorStack };
    emit(EventType.NET_PENDING, { id, method, url, initiator: 'fetch', ...initiatorFields });
    try {
      const res = await callFetch(input, init);
      const contentType = res.headers.get('content-type');
      // Read a CLONE so the app's response stream stays untouched. Dev-only opt-in; only text-like
      // bodies; a read failure never breaks the observation.
      let responseBodyFields: Record<string, unknown> = {};
      // Streaming content types are skipped outright (zero cost, covers SSE); anything else is read behind
      // a deadline. Gating on `content-length` instead was tried and REJECTED — plenty of complete responses
      // omit it (gzip, HTTP/2), so it silently stopped capturing bodies for ordinary apps. This comment
      // previously described that rejected design as though it were the implementation.
      if (captureBodies && isCapturableType(contentType)) {
        // Bounded: a chunked response with no content-length can still be arbitrarily long, and the app
        // must never wait on our read. Race the clone against a deadline and drop the body on timeout.
        try {
          const text = await withBodyDeadline(res.clone().text());
          if (text !== undefined) {
            const { body, truncated } = projectBody(text, contentType);
            responseBodyFields = truncated
              ? { responseBody: body, responseBodyTruncated: true }
              : { responseBody: body };
          }
        } catch {
          /* body not readable (already locked/consumed) — skip, keep the envelope */
        }
      }
      emit(EventType.NET_REQUEST, {
        id,
        method,
        url,
        status: res.status,
        ok: res.ok,
        durationMs: Math.round(performance.now() - start),
        initiator: 'fetch',
        ...initiatorFields,
        ...resourceTiming(rawUrl),
        ...netResponseMeta(res.statusText, contentType, res.headers.get('content-length')),
        ...projectRequestBody(init?.body, captureBodies),
        ...responseBodyFields,
      });
      return res;
    } catch (error) {
      emit(EventType.NET_REQUEST, {
        id,
        method,
        url,
        status: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - start),
        initiator: 'fetch',
        ...initiatorFields,
      });
      throw error;
    }
  };
  // Remember it, so a later install recognises our own wrapper instead of reporting the app.
  OURS.add(window.fetch);
  const patchedFetch = window.fetch;

  const meta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const proto = XMLHttpRequest.prototype;
  const origOpen = captureMethod(proto, 'open');
  const origSend = captureMethod(proto, 'send');
  const callOpen = origOpen as (this: XMLHttpRequest, ...args: unknown[]) => void;

  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    meta.set(this, {
      id: nextId(),
      method: method.toUpperCase(),
      url: redactUrl(String(url)),
      rawUrl: String(url),
      start: 0,
    });
    callOpen.call(this, method, url, ...rest);
  };
  const patchedOpen = captureMethod(proto, 'open');

  // A reused XHR calls send repeatedly; attach the completion listener ONCE per instance and read the
  // request identity from `meta` at fire time. Adding a fresh closure each send would leave stale
  // listeners that re-fire on later completions, emitting duplicate, mislabeled events.
  const listenerAttached = new WeakSet<XMLHttpRequest>();
  proto.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const m = meta.get(this);
    if (m !== undefined) {
      m.start = performance.now();
      m.reqBody = body ?? null;
      m.initiatorStack = initiatorFrame(); // the app's xhr.send call site
      const initiatorFields =
        m.initiatorStack === undefined ? {} : { initiatorStack: m.initiatorStack };
      emit(EventType.NET_PENDING, {
        id: m.id,
        method: m.method,
        url: m.url,
        initiator: 'xhr',
        ...initiatorFields,
      });
      if (!listenerAttached.has(this)) {
        listenerAttached.add(this);
        this.addEventListener('loadend', () => {
          const cur = meta.get(this);
          if (cur === undefined) return;
          const xhrContentType = this.getResponseHeader('content-type');
          let responseBodyFields: Record<string, unknown> = {};
          // responseText throws unless responseType is '' or 'text' — guard before reading.
          const textReadable = this.responseType === '' || this.responseType === 'text';
          if (captureBodies && textReadable && isCapturableType(xhrContentType)) {
            try {
              const { body: rb, truncated } = projectBody(this.responseText, xhrContentType);
              responseBodyFields = truncated
                ? { responseBody: rb, responseBodyTruncated: true }
                : { responseBody: rb };
            } catch {
              /* unreadable body — skip */
            }
          }
          emit(EventType.NET_REQUEST, {
            id: cur.id,
            method: cur.method,
            url: cur.url,
            status: this.status,
            ok: this.status >= 200 && this.status < 400,
            durationMs: Math.round(performance.now() - cur.start),
            initiator: 'xhr',
            ...(cur.initiatorStack === undefined ? {} : { initiatorStack: cur.initiatorStack }),
            ...resourceTiming(cur.rawUrl),
            ...netResponseMeta(
              this.statusText,
              xhrContentType,
              this.getResponseHeader('content-length'),
            ),
            ...projectRequestBody(cur.reqBody, captureBodies),
            ...responseBodyFields,
          });
        });
      }
    }
    origSend.call(this, body ?? null);
  };
  const patchedSend = captureMethod(proto, 'send');

  // SSE + WebSocket frame capture — gated behind body capture, since a chatty stream is the
  // high-volume case. Subclass the native constructors so the app's own usage is unchanged.
  const origEventSource = window.EventSource;
  const origWebSocket = window.WebSocket;
  let patchedEventSource: typeof window.EventSource | undefined;
  let patchedWebSocket: typeof window.WebSocket | undefined;
  if (captureBodies && typeof origEventSource === 'function') {
    window.EventSource = class extends origEventSource {
      constructor(u: string | URL, init?: EventSourceInit) {
        super(u, init);
        const url = redactUrl(String(u));
        emit(EventType.NET_STREAM, {
          transport: StreamTransport.SSE,
          direction: StreamDirection.OPEN,
          url,
        });
        this.addEventListener('message', (ev: MessageEvent) => {
          emit(EventType.NET_STREAM, {
            transport: StreamTransport.SSE,
            direction: StreamDirection.IN,
            url,
            ...frameFields(ev.data, captureBodies),
          });
        });
      }
    };
    patchedEventSource = window.EventSource;
  }
  if (captureBodies && typeof origWebSocket === 'function') {
    window.WebSocket = class extends origWebSocket {
      /** Reticle's own bridge socket is never observed — see isBridgeSocket. */
      readonly #isBridge: boolean;
      constructor(u: string | URL, protocols?: string | string[]) {
        super(u, protocols);
        this.#isBridge = isBridgeSocket(String(u));
        if (this.#isBridge) return;
        const url = redactUrl(String(u));
        emit(EventType.NET_STREAM, {
          transport: StreamTransport.WS,
          direction: StreamDirection.OPEN,
          url,
        });
        this.addEventListener('message', (ev: MessageEvent) => {
          emit(EventType.NET_STREAM, {
            transport: StreamTransport.WS,
            direction: StreamDirection.IN,
            url,
            ...frameFields(ev.data, captureBodies),
          });
        });
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.#isBridge) {
          super.send(data);
          return;
        }
        emit(EventType.NET_STREAM, {
          transport: StreamTransport.WS,
          direction: StreamDirection.OUT,
          url: redactUrl(this.url),
          ...frameFields(data, captureBodies),
        });
        super.send(data);
      }
    };
    patchedWebSocket = window.WebSocket;
  }

  // navigator.sendBeacon — fire-and-forget analytics/telemetry, invisible to fetch/XHR wrapping. A page
  // that beacons a "checkout completed" event should show it. Patch the instance's prototype (via
  // getPrototypeOf, robust whether or not the Navigator global exists); the descriptor read avoids an
  // unbound-method access; the send is synchronous so we emit one completed NET_REQUEST with its result.
  const navProto = (
    typeof navigator !== 'undefined' ? Object.getPrototypeOf(navigator) : null
  ) as Navigator | null;
  const origBeacon = (
    navProto === null ? undefined : Object.getOwnPropertyDescriptor(navProto, 'sendBeacon')?.value
  ) as BeaconFn | undefined;
  let patchedBeacon: BeaconFn | undefined;
  if (navProto !== null && origBeacon !== undefined) {
    patchedBeacon = function (this: Navigator, url: string | URL, data?: BodyInit | null): boolean {
      const id = nextId();
      const redacted = redactUrl(String(url));
      const initiatorStack = initiatorFrame();
      const sent = origBeacon.call(this, url, data);
      emit(EventType.NET_REQUEST, {
        id,
        method: 'POST',
        url: redacted,
        status: sent ? 200 : 0,
        ok: sent,
        durationMs: 0,
        initiator: 'beacon',
        ...(initiatorStack === undefined ? {} : { initiatorStack }),
      });
      return sent;
    };
    navProto.sendBeacon = patchedBeacon;
  }

  return () => {
    // Restore each slot ONLY if it still holds OUR wrapper. Between connect() and disconnect() the app
    // (or Sentry/analytics/a router) may have wrapped fetch/XHR/EventSource/WebSocket/sendBeacon ON TOP
    // of ours; blindly writing the original back would silently uninstall their instrumentation — the
    // dev-only SDK breaking the app it only meant to observe.
    if (window.fetch === patchedFetch) window.fetch = origFetch;
    if (captureMethod(proto, 'open') === patchedOpen) proto.open = origOpen;
    if (captureMethod(proto, 'send') === patchedSend) proto.send = origSend;
    if (patchedEventSource !== undefined && window.EventSource === patchedEventSource) {
      window.EventSource = origEventSource;
    }
    if (patchedWebSocket !== undefined && window.WebSocket === patchedWebSocket) {
      window.WebSocket = origWebSocket;
    }
    if (navProto !== null && origBeacon !== undefined && navProto.sendBeacon === patchedBeacon) {
      navProto.sendBeacon = origBeacon;
    }
  };
}

type BeaconFn = (this: Navigator, url: string | URL, data?: BodyInit | null) => boolean;
