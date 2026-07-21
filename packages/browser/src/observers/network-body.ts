/**
 * Response/request BODY projection for the network observer.
 *
 * Split out of network.ts, which had grown to hold URL redaction, body projection, fetch, XHR, SSE,
 * WebSocket and sendBeacon at once. This module owns exactly one question: given a body, what is safe
 * and affordable to report?
 */
import { nativeSetTimeout } from '../timers/native-timers.js';

/** Only text-like bodies are worth capturing; binary (images/fonts/octet-stream) is skipped. */
const CAPTURABLE_CONTENT =
  /application\/json|text\/|application\/xml|x-www-form-urlencoded|graphql/i;

/**
 * Content types that are STREAMS, never complete bodies.
 *
 * `text/event-stream` matches `text/` in CAPTURABLE_CONTENT, and body capture awaited
 * `res.clone.text` BEFORE returning the response to the app. A clone of a stream only settles when
 * the stream ends — and an SSE stream does not end — so the app's `await fetch...)` never resolved.
 * Enabling body capture silently hung every streaming endpoint (SSE, and the chunked `application/json`
 * every token-streaming model API uses), leaving a permanently loading UI with no reason to suspect the
 * observability SDK. Never read these; the frame observer covers SSE properly.
 */
const STREAMING_CONTENT = /event-stream|x-ndjson|application\/stream/i;

/**
 * Longest the SDK will wait on a response-body clone before emitting without it.
 *
 * Two layers protect the app. `text/event-stream` and friends are skipped outright, which covers the
 * common streaming case at zero cost. This deadline is the backstop for a body that streams WITHOUT
 * announcing it in its content type — chunked `application/json` from a token-streaming API. Gating on
 * `content-length` instead was tried and rejected: plenty of complete responses omit it (gzip, HTTP/2),
 * so that would silently stop capturing bodies for ordinary apps. A bounded half-second on a rare path
 * beats an unbounded hang, and beats losing capture everywhere.
 */
const BODY_READ_TIMEOUT_MS = 500;

/**
 * Resolve with the body text, or `undefined` if it takes too long.
 *
 * The app is already awaiting our patched fetch, so any unbounded read here is a hang in the host app.
 * Losing an observation is always preferable to freezing the page being observed.
 */
export async function withBodyDeadline(read: Promise<string>): Promise<string | undefined> {
  return await Promise.race([
    read,
    new Promise<undefined>((resolve) => {
      nativeSetTimeout(() => resolve(undefined), BODY_READ_TIMEOUT_MS);
    }),
  ]);
}

export function isCapturableType(contentType: string | null): boolean {
  if (contentType === null) return false;
  if (STREAMING_CONTENT.test(contentType)) return false;
  return CAPTURABLE_CONTENT.test(contentType);
}
