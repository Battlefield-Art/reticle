import { EventType, type ReticleEvent } from '@reticlehq/core';

/**
 * CDP-authoritative network detail, driven only). On the `reticle drive` path the daemon owns a
 * Playwright browser; its `page.on('response')` sees the FULL response — status, mime type, and every
 * response header — which the in-page fetch/XHR wrapper cannot read (CORS-opaque headers, redirects).
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
}): NetworkDetail {
  return {
    url: raw.url,
    ...(raw.method === undefined ? {} : { method: raw.method }),
    status: raw.status,
    headers: lowerKeys(raw.headers),
    ...(raw.resourceType === undefined ? {} : { resourceType: raw.resourceType }),
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
  request(): { method(): string; resourceType?(): string };
}
export interface PageLike {
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
      emit(
        buildNetworkDetail({
          url: response.url(),
          method: request.method(),
          status: response.status(),
          headers,
          ...(resourceType === undefined ? {} : { resourceType }),
        }),
      );
    });
  });
}
