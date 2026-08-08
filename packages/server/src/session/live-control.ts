import { HumanControlKind, SessionState, type HumanControlData } from '@reticlehq/core';

/** Live-control: a human note queued for the agent, stamped with session-relative elapsed time. */
export interface InboxMessage {
  text: string;
  t: number;
}

/**
 * The human-in-the-loop half of a session: its lifecycle state, and the one-way inbox a person uses
 * to talk to the agent driving their browser.
 *
 * Server-owned on purpose — a paused session has to stay paused even if the page reloads, so this
 * cannot live in the tab. Split out of Session because it shares nothing with the transport, the
 * ring buffer, or the journal: it is state a HUMAN changes, on a human's timescale, while everything
 * else in Session is driven by the event stream.
 */
export class LiveControl {
  #state: SessionState = SessionState.ACTIVE;
  readonly #inbox: InboxMessage[] = [];

  state(): SessionState {
    return this.#state;
  }

  isPaused(): boolean {
    return this.#state === SessionState.PAUSED;
  }

  isEnded(): boolean {
    return this.#state === SessionState.ENDED;
  }

  /** Set the lifecycle state. Echoing it to the presenter is the caller's job (one push per change). */
  setState(next: SessionState): void {
    this.#state = next;
  }

  /** Queue a human note. Empty/whitespace-only text is ignored so a stray enter cannot spam the agent. */
  push(text: string, t: number): void {
    const trimmed = text.trim();
    if (0 === trimmed.length) return;
    this.#inbox.push({ text: trimmed, t });
  }

  /** Return the queued notes AND clear them — delivered once, so a hint never repeats. */
  drain(): InboxMessage[] {
    return this.#inbox.splice(0, this.#inbox.length);
  }

  /** Diagnostic read of the inbox depth (does not clear). */
  size(): number {
    return this.#inbox.length;
  }

  /**
   * The state a human control should move this session to, or undefined for "no change".
   *
   * Returning the decision rather than applying it keeps the ONE-PUSH-PER-TRANSITION rule enforceable
   * by the caller: a no-op (resume while already active, pause after end) yields undefined and so
   * cannot emit a presenter push. `ended` is terminal — pause and resume after it do nothing.
   */
  nextStateFor(data: HumanControlData): SessionState | undefined {
    if (this.isEnded()) return undefined;
    switch (data.kind) {
      case HumanControlKind.PAUSE:
        return this.isPaused() ? undefined : SessionState.PAUSED;
      case HumanControlKind.RESUME:
        return this.#state === SessionState.ACTIVE ? undefined : SessionState.ACTIVE;
      case HumanControlKind.END:
        return SessionState.ENDED;
      default:
        return undefined;
    }
  }
}
