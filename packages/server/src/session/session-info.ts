/**
 * The shape `reticle_sessions` returns for one connected tab.
 *
 * Split from session.ts when that file crossed the 600-line cap. A pure description of what a
 * session looks like from the outside has no reason to live inside the class that happens to build
 * it, and separating them keeps the wire-facing shape reviewable on its own.
 */
export interface SessionInfo {
  sessionId: string;
  url: string;
  /** Stable build-stamped project identity; absent for v1.0 SDKs that don't send it. */
  projectId?: string;
  title: string;
  adapters: string[];
  hasCapabilities: boolean;
  /** ms since the SDK last reported anything (silence ⇒ likely throttled). */
  lastSeenMs: number;
  hidden: boolean;
  focused: boolean;
  throttled: boolean;
  /** present only when hidden/throttled — points at the `reticle drive` escape hatch. */
  recommendation?: string;
  stale?: boolean;
  cleanup_suggestion?: string;
  /** present only when the human has flagged bugs on this tab — count of pending review marks. */
  pendingMarks?: number;
  /** present with pendingMarks — nudges the agent to drain them with reticle_review. */
  review_suggestion?: string;
}
