import {
  EventType,
  REDACTED_VALUE,
  isSensitiveKey,
  scrubKnownSecrets,
  type ReticleEvent,
} from '@reticlehq/core';

/**
 * CDP-authoritative network detail. Wherever the daemon has a CDP connection — whether it launched
 * the browser or attached to one someone else started — `page.on('response')` sees the FULL response:
 * status, mime type, and every response header, including the ones the in-page fetch/XHR wrapper
 * structurally cannot read (CORS-opaque headers, redirects).
 * Capturing it as a NET_DETAIL event and merging it onto the matching in-page NET_REQUEST means the
 * driven view never loses fidelity to an outside-in tool. Pure builder + merge are unit-tested; the
 * `page.on` attachment is thin Playwright glue (exercised e2e, like the pool launcher).
 */

export interface NetworkDetail {
  url: string;
  method?: string;
  status: number;
  headers: Record<string, string>;
  resourceType?: string;
  /**
   * The request body as the NETWORK STACK saw it — what actually left, not what the page handed to
   * fetch. Redacted and bounded here because it arrives raw from the driver.
   *
   * This is the one thing in-page instrumentation structurally cannot get: Reticle reads `init.body`
   * inside its own fetch wrapper, and whoever patches fetch last is outermost — app bootstrap
   * decides that, not us. An interceptor initialised after connect(), or a service worker (no
   * window.fetch frame at all), rewrites requests invisibly. Available on the DRIVE path only.
   */
  requestBody?: string;
  /**
   * The document that ISSUED the request, which is what identifies the session it belongs to.
   *
   * Routing used to match the REQUEST's origin against the session's, falling back to the drive
   * URL's. Both miss the ordinary case: an app on one origin calling an API on another produces a
   * detail matching no session, so it was dropped silently — and on the CDP-attach path there is no
   * drive URL, so the fallback matched nothing at all. Cross-origin API calls are most API calls.
   */
  pageUrl?: string;
}

/** Bound on a captured wire body — matches the in-page capture so the two are comparable. */
const MAX_WIRE_BODY_CHARS = 8192;

/**
 * Redact and bound a raw wire body.
 *
 * Playwright hands this over unscrubbed, so it is the one payload in the system that reaches the
 * journal without having passed through the SDK's sanitizer. Both passes matter: `scrubKnownSecrets`
 * catches credential SHAPES wherever they sit, and the key sweep catches values under a
 * credential-named field whose shape is unremarkable (a plain password).
 */
function projectWireBody(raw: string): string {
  const bounded = raw.length > MAX_WIRE_BODY_CHARS ? raw.slice(0, MAX_WIRE_BODY_CHARS) : raw;
  const byShape = scrubKnownSecrets(bounded);
  // Field-name sweep over JSON-ish `"key": "value"` pairs — string-level so it never has to parse
  // (and so a truncated body, which is no longer valid JSON, is still redacted).
  return byShape.replace(/"([^"]+)"\s*:\s*"([^"]*)"/g, (whole, key: string) =>
    isSensitiveKey(key) ? `"${key}":"${REDACTED_VALUE}"` : whole,
  );
}

/** Header names are case-insensitive; normalize to lower-case so a merge/compare is stable. */
function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

/** Shape a raw authoritative response into a NET_DETAIL payload (lower-cased headers). */
export function buildNetworkDetail(raw: {
  url: string;
  method?: string;
  status: number;
  headers: Record<string, string>;
  resourceType?: string;
  requestBody?: string;
  pageUrl?: string;
}): NetworkDetail {
  return {
    url: raw.url,
    ...(raw.method === undefined ? {} : { method: raw.method }),
    status: raw.status,
    headers: lowerKeys(raw.headers),
    ...(raw.resourceType === undefined ? {} : { resourceType: raw.resourceType }),
    ...(raw.requestBody === undefined || raw.requestBody.length === 0
      ? {}
      : { requestBody: projectWireBody(raw.requestBody) }),
    ...(raw.pageUrl === undefined || raw.pageUrl.length === 0 ? {} : { pageUrl: raw.pageUrl }),
  };
}

function keyOf(url: unknown, method: unknown): string {
  const m = typeof method === 'string' ? method.toUpperCase() : '';
  const u = typeof url === 'string' ? url : '';
  return `${m} ${u}`;
}

/**
 * Fold each NET_DETAIL onto the matching in-page NET_REQUEST (by method+url), enriching it with the
 * authoritative headers/resourceType the page-side wrapper couldn't see — WITHOUT clobbering fields the
 * in-page event already carries. A NET_DETAIL with no matching request is kept as its own event (a
 * response the wrapper missed is signal, never silently dropped). Pure over the event list.
 */
export function mergeNetworkDetail(events: readonly ReticleEvent[]): ReticleEvent[] {
  const requestByKey = new Map<string, ReticleEvent>();
  for (const e of events) {
    if (e.type === EventType.NET_REQUEST) requestByKey.set(keyOf(e.data['url'], e.data['method']), e);
  }
  const out: ReticleEvent[] = [];
  const enriched = new Map<ReticleEvent, ReticleEvent>();
  for (const e of events) {
    if (e.type === EventType.NET_DETAIL) {
      const match = requestByKey.get(keyOf(e.data['url'], e.data['method']));
      if (match === undefined) {
        out.push(e); // unmatched detail survives on its own
        continue;
      }
      const base = enriched.get(match) ?? match;
      const data = { ...base.data };
      if (data['headers'] === undefined && e.data['headers'] !== undefined) {
        data['headers'] = e.data['headers'];
      }
      if (data['resourceType'] === undefined && e.data['resourceType'] !== undefined) {
        data['resourceType'] = e.data['resourceType'];
      }
      // The ONLY field that overwrites rather than filling a gap. The in-page value is what the app
      // INTENDED to send; this is what actually went. When they disagree, the disagreement is the
      // finding — that is the whole reason for capturing it — so the authoritative one wins and the
      // divergence is flagged rather than silently resolved.
      const wireBody = e.data['requestBody'];
      if (typeof wireBody === 'string') {
        const pageBody = data['requestBody'];
        if (typeof pageBody === 'string' && pageBody !== wireBody) {
          data['requestBodyDivergedFromPage'] = true;
        }
        data['requestBody'] = wireBody;
      }
      enriched.set(match, { ...base, data });
      continue; // the detail is absorbed into the request
    }
  }
  for (const e of events) {
    if (e.type === EventType.NET_DETAIL) continue; // handled above
    out.push(enriched.get(e) ?? e);
  }
  return out;
}

/** The minimal Playwright surfaces this attachment reads — kept structural so it's fake-testable. */
export interface ResponseLike {
  url(): string;
  status(): number;
  headers(): Record<string, string> | Promise<Record<string, string>>;
  request(): { method(): string; resourceType?(): string; postData?(): string | null };
}
export interface PageLike {
  url(): string;
  on(event: 'response', handler: (response: ResponseLike) => void): void;
}

/**
 * Attach a response listener to a driven page: every response becomes a NET_DETAIL via `emit`. Thin glue
 * over Playwright's event surface — the daemon routes `emit` to the driven session's pushEvent.
 */
export function attachNetworkDetail(page: PageLike, emit: (detail: NetworkDetail) => void): void {
  page.on('response', (response) => {
    void Promise.resolve(response.headers()).then((headers) => {
      const request = response.request();
      const resourceType = request.resourceType?.();
      // postData is null for GETs and for bodies the driver did not retain; both mean "nothing to say".
      const postData = request.postData?.() ?? null;
      emit(
        buildNetworkDetail({
          url: response.url(),
          method: request.method(),
          status: response.status(),
          headers,
          ...(resourceType === undefined ? {} : { resourceType }),
          ...(postData === null ? {} : { requestBody: postData }),
          pageUrl: page.url(),
        }),
      );
    });
  });
}
