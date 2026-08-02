import type { WebSocket } from 'ws';
import { commandTimeoutMessage, type PageRuntime } from './command-timeout.js';
import { readHealthEvent, type SessionHealth } from './session-health.js';

export type { SessionHealth };
import { PendingCommands } from './pending-commands.js';
import {
  EventType,
  HumanControlDataSchema,
  HumanControlKind,
  HumanMarkDataSchema,
  ReticleCommand,
  MessageKind,
  PresenterTone,
  SESSION_HEALTH,
  SESSION_LEASE,
  SESSION_LIFECYCLE,
  SessionState,
  type CommandResult,
  type HelloMessage,
  type HumanControlData,
  type ReticleEvent,
} from '@reticlehq/core';
import { RingBuffer } from '../events/ring-buffer.js';
import type { JournalReader, JournalRecorder } from '../journal/journal-recorder.js';
import {
  filterEvents,
  mergeEventsBySeq,
  type EventQueryOptions,
} from '../journal/journal-query.js';
import { type AmbientCounts } from '../journal/ambient.js';
import { ObservedState } from './observed-state.js';
import { LiveControl, type InboxMessage } from './live-control.js';
export type { InboxMessage } from './live-control.js'; // moved; still part of Session's surface
import { ReviewStore, type ReviewMark } from './review-store.js';
import { buildSessionRecommendation } from './session-recommendation.js';
import { buildPresenterArgs } from './presenter-args.js';
import type { SessionInfo } from './session-info.js';
export type { SessionInfo } from './session-info.js';

type Clock = () => number;

const DEFAULT_COMMAND_TIMEOUT_MS = 8000;

/** Prefix on correlated command ids (c1, c2, …) — distinguishes them from mark ids. */
const COMMAND_ID_PREFIX = 'c';

/** Prefix on minted action ids (a1, a2, …) — the journal's action identity, independent of commands. */
const ACTION_ID_PREFIX = 'a';

/** ws readyState for an OPEN socket — guard fire-and-forget pushes against a closing tab. */
const WS_OPEN = 1;

/**
 * One connected browser tab. Owns its socket, a ring buffer of observations, and the
 * in-flight command map. `clock` is injected so elapsed-time logic stays testable.
 */
export class Session {
  readonly id: string;
  /** Stable build-stamped project identity; undefined for v1.0 SDKs that omit it. */
  readonly projectId: string | undefined;
  url: string;
  title: string;
  adapters: string[];
  hasCapabilities: boolean;

  readonly #socket: WebSocket;
  readonly #clock: Clock;
  readonly #startedAt: number;
  readonly #buffer = new RingBuffer();
  readonly #pending = new PendingCommands();
  readonly #listeners = new Set<(event: ReticleEvent) => void>();
  #actionSeq = 0;
  #lastSeenAt: number;
  #hidden = false;
  /** Which shell the page reported (PAGE_HEALTH). Undefined until the first report lands. */
  #runtime: PageRuntime | undefined;
  #focused = true;
  #lastActCursor: number | undefined;
  #lastActSource: string | undefined;
  /** Liveness: wall-clock of the last AGENT command (distinct from browser chatter / lastSeen). */
  #lastAgentActivityAt: number;
  /** Server-side mirror of the agent-tuned idle window, so the reaper honors reticle_session. */
  #idleEndMs: number = SESSION_LIFECYCLE.IDLE_END_MS;
  /** True when the reaper/disconnect ended this session — such an end is revivable; explicit ends are not. */
  #autoEnded = false;
  readonly #live = new LiveControl();
  /** Human review marks: mistakes the human pinned to elements, for the agent to drain and fix. */
  readonly #review = new ReviewStore();
  /** Whether the session_lease has already been returned (fire-once per session). */
  #firstCommandDone = false;
  /** Durable causal-journal recorder; undefined when journaling is off (opt-out or not yet attached). */
  #journal: JournalRecorder | undefined;
  #activeActionId: string | undefined; // action window, held independently of the journal
  /** Read side of the journal, for queries that must survive ring-buffer eviction. */
  #journalReader: JournalReader | undefined;
  /** What this session has learned by watching its own stream: ambient churn + blind-spot levels. */
  readonly #observed = new ObservedState();

  constructor(hello: HelloMessage, socket: WebSocket, clock: Clock) {
    this.id = hello.sessionId;
    this.projectId = hello.projectId;
    this.url = hello.url;
    this.title = hello.title;
    this.adapters = hello.adapters;
    this.hasCapabilities = hello.hasCapabilities ?? false;
    this.#socket = socket;
    this.#clock = clock;
    this.#startedAt = clock();
    this.#lastSeenAt = clock();
    this.#lastAgentActivityAt = clock();
  }

  /** Milliseconds since this session connected — the authoritative buffer clock. */
  elapsed(): number {
    return this.#clock() - this.#startedAt;
  }

  /** Mark that the SDK was just heard from. Called on every inbound message. */
  touch(): void {
    this.#lastSeenAt = this.#clock();
  }

  /** ms since the SDK last reported anything (distinct from elapsed-since-connect). */
  lastSeenMs(): number {
    return this.#clock() - this.#lastSeenAt;
  }

  /**
   * Record the latest page visibility/focus state from a PAGE_HEALTH event.
   *
   * `runtime` is optional so an older SDK (which does not report it) still works — it simply loses
   * the desktop-specific timeout diagnosis rather than breaking.
   */
  applyHealth(hidden: boolean, focused: boolean, runtime?: string): void {
    this.#hidden = hidden;
    this.#focused = focused;
    if (runtime === 'electron' || runtime === 'tauri' || runtime === 'web') {
      this.#runtime = runtime;
    }
  }

  /** Throttled if the tab is hidden OR we have not heard from it recently. */
  throttled(): boolean {
    return this.#hidden || this.lastSeenMs() > SESSION_HEALTH.STALE_THRESHOLD_MS;
  }

  /** The attachable health block — single source of truth for the tools. */
  health(): SessionHealth {
    const base: SessionHealth = {
      lastSeenMs: this.lastSeenMs(),
      throttled: this.throttled(),
      focused: this.#focused,
    };
    // attach the escape-hatch hint only when un-scriptable (keeps field absent otherwise).
    const recommendation = buildSessionRecommendation({
      hidden: this.#hidden,
      throttled: base.throttled,
      focused: base.focused,
    });
    return recommendation === undefined ? base : { ...base, recommendation };
  }

  info(): SessionInfo {
    const base: SessionInfo = {
      sessionId: this.id,
      url: this.url,
      ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
      title: this.title,
      adapters: this.adapters,
      hasCapabilities: this.hasCapabilities,
      hidden: this.#hidden,
      ...this.health(),
    };
    if (this.staleMs() > SESSION_LEASE.STALE_AFTER_MS) {
      base.stale = true;
      base.cleanup_suggestion =
        'Call reticle_end_session to free this session before starting new work.';
    }
    // Surface human bug reports in reticle_sessions (only when > 0, so a clean session adds nothing).
    const marks = this.#review.pendingCount();
    if (marks > 0) {
      base.pendingMarks = marks;
      const s = marks === 1 ? '' : 's';
      base.review_suggestion = `The human flagged ${String(marks)} issue${s} on this tab — call reticle_review to see and fix ${marks === 1 ? 'it' : 'them'}.`;
    }
    return base;
  }

  /** Wall-clock age of the session in milliseconds. */
  staleMs(): number {
    return this.#clock() - this.#startedAt;
  }

  /** Re-stamp an incoming event with server-relative time, buffer it, and fan out. */
  pushEvent(event: ReticleEvent, byteSize?: number): void {
    if (event.type === EventType.PAGE_HEALTH) {
      const report = readHealthEvent(event.data);
      this.applyHealth(
        report.hidden ?? this.#hidden,
        report.focused ?? this.#focused,
        report.runtime,
      );
    }
    if (event.type === EventType.HUMAN_CONTROL) {
      // Narrow unknown at the boundary; an invalid/unknown control is ignored (never thrown).
      const parsed = HumanControlDataSchema.safeParse(event.data);
      if (parsed.success) this.applyHumanControl(parsed.data);
    }
    if (event.type === EventType.HUMAN_MARK) {
      // A human pinned a mistake to an element. Narrow at the boundary; an invalid mark is ignored.
      const parsed = HumanMarkDataSchema.safeParse(event.data);
      if (parsed.success) this.#review.add(parsed.data, this.elapsed());
    }
    if (event.type === EventType.ROUTE_CHANGE) {
      // Keep the reported URL live across SPA navigation. The SDK already emits route.change on
      // pushState/replaceState/popstate; without this the URL stays frozen at the hello value, and
      // URL-based CDP correlation (real input) silently breaks after the first client-side nav.
      const to = event.data['to'];
      if (typeof to === 'string' && to.length > 0) this.url = to;
    }
    const t = this.elapsed();
    const stamped: ReticleEvent = { ...event, t, sessionId: this.id };
    // The recorder attributes the event to the in-flight action (if any) and journals it durably; the
    // returned event carries actionId/attribution so the buffer + all queries see the same causal link.
    // Falls back to the session's own window so attribution survives the journal being switched off.
    const seen = this.#journal?.observe(stamped) ?? stamped;
    const fallback = this.#activeActionId;
    const attributed =
      seen.actionId === undefined && fallback !== undefined
        ? { ...seen, actionId: fallback }
        : seen;
    this.#observed.observe(attributed);
    this.#buffer.push(attributed, t, byteSize);
    for (const listener of this.#listeners) listener(attributed);
  }

  /** Refs the agent has driven — the denominator side of reticle_coverage. See ObservedState. */
  recordActedRef(ref: string): void {
    this.#observed.recordActedRef(ref);
  }

  /** Every ref driven so far this session. */
  actedRefs(): ReadonlySet<string> {
    return this.#observed.actedRefs();
  }

  /** Latest count per blind-spot kind; survives buffer eviction. See ObservedState for why. */
  blindSpots(): Readonly<Record<string, number>> {
    return this.#observed.blindSpots();
  }

  /** Learned ambient-churn counts (PredicateSession hook the settle oracle reads). */
  ambientCounts(): AmbientCounts {
    return this.#observed.ambientCounts();
  }

  /** Only what THIS session observed — what teardown accumulates onto the persisted map. */
  ownAmbientCounts(): AmbientCounts {
    return this.#observed.ownAmbientCounts();
  }

  /** Seed the ambient map from the persisted per-app `.reticle/ambient.json` (sharpens across sessions). */
  seedAmbient(counts: AmbientCounts): void {
    this.#observed.seedAmbient(counts);
  }

  /**
   * Attach the durable causal-journal recorder (off by default; wired at session creation). The optional
   * reader is the query fall-through source — pass it to make `queryEvents` survive buffer eviction.
   */
  setJournal(recorder: JournalRecorder, reader?: JournalReader): void {
    this.#journal = recorder;
    this.#journalReader = reader;
  }

  /**
   * Journal-backed event query: the ring buffer's events, merged with the durable journal **only when
   * the buffer has evicted** (so a healthy session pays no disk cost), then filtered by since/until/
   * actionId. This is how "what did action N cause" is answered after the buffer has dropped the
   * evidence — the substrate's whole point. The sync `eventsSince`/`window` stay for the hot path.
   */
  async queryEvents(options: EventQueryOptions): Promise<ReticleEvent[]> {
    if (this.#journalReader !== undefined && this.#buffer.bufferHealth().dropped > 0) {
      const durable = await this.#journalReader.readEvents();
      return filterEvents(mergeEventsBySeq(durable, this.#buffer.since(0)), options);
    }
    return filterEvents(this.#buffer.since(options.since ?? 0), options);
  }

  /**
   * Open an action-attribution window: events observed until finishAction attribute to the returned
   * action id. Ids are minted independently of command correlation ids so the journal is self-contained.
   */
  beginAction(tool: string, args: Record<string, unknown>): string {
    this.#actionSeq += 1;
    const actionId = `${ACTION_ID_PREFIX}${String(this.#actionSeq)}`;
    // Held here, not only in the journal: with the journal off every event was unattributed, and
    // pushEvent reads that as ambient churn the settle oracle then ignores. See action-attribution test.
    this.#activeActionId = actionId;
    this.#journal?.beginAction(actionId, tool, args);
    return actionId;
  }

  /** Close the active action window, persisting its action record with the settle outcome. */
  finishAction(effect?: unknown, settled?: boolean, settledInMs?: number): void {
    this.#activeActionId = undefined;
    this.#journal?.finishAction(effect, settled, settledInMs);
  }

  /** Flush any buffered journal events to disk (call on session end). */
  async flushJournal(): Promise<void> {
    await this.#journal?.flush();
  }

  eventsSince(cursor: number): ReticleEvent[] {
    return this.#buffer.since(cursor);
  }

  /**
   * Honesty: remember the event cursor of the most recent act so wait_for/assert can default their
   * evaluation floor to it — a signal buffered before this act can never fake a later pass.
   */
  markActCursor(cursor: number): void {
    this.#lastActCursor = cursor;
  }

  /** The cursor of the last act, or undefined if nothing has acted yet. */
  lastActCursor(): number | undefined {
    return this.#lastActCursor;
  }

  /** Remember where the last acted control is written (`file:line`), for failures with no element. */
  markActSource(source: string | undefined): void {
    this.#lastActSource = source;
  }

  /** Where the last acted control is written, or undefined if nothing has acted yet. */
  lastActSource(): string | undefined {
    return this.#lastActSource;
  }

  // ── Server-authoritative liveness (immune to browser-tab throttling) ──────────────

  /**
   * Stamp the wall-clock of the latest AGENT command (called whenever a tool resolves this session).
   * If the reaper had auto-ended the session, a fresh command means the agent is alive again, so the
   * session is REVIVED to ACTIVE. An EXPLICIT end (human/agent reticle_end_session) is terminal and is
   * never revived here.
   */
  markAgentActivity(): void {
    this.#lastAgentActivityAt = this.#clock();
    if (this.#live.isEnded() && this.#autoEnded) {
      this.#autoEnded = false;
      this.setState(SessionState.ACTIVE);
    }
  }

  /** ms since the agent last issued a command against this session (the reaper's idle signal). */
  agentIdleMs(): number {
    return this.#clock() - this.#lastAgentActivityAt;
  }

  /** The agent-idle window after which the reaper ends this session. */
  idleEndMs(): number {
    return this.#idleEndMs;
  }

  /** Tune the idle window (reticle_session). Floored so an agent can't disable the safety net. */
  setIdleEndMs(ms: number): void {
    this.#idleEndMs = Math.max(SESSION_LIFECYCLE.IDLE_END_MIN_MS, Math.floor(ms));
  }

  /**
   * Reaper/disconnect end: terminal like a normal end (pushes PRESENTER ended to the browser, which a
   * throttled tab still receives) but flagged auto-ended so a returning agent revives it. No-op if
   * already ended.
   */
  autoEnd(text?: string, tone: PresenterTone = PresenterTone.WARN): void {
    if (this.#live.isEnded()) return;
    this.#autoEnded = true;
    this.setState(SessionState.ENDED, text, tone);
  }

  eventsInWindow(windowMs: number): ReticleEvent[] {
    return this.#buffer.window(windowMs, this.elapsed());
  }

  /** Buffer honesty: events currently held + cumulative evictions since connect (for false-negative detection). */
  bufferHealth(): { total: number; dropped: number } {
    return this.#buffer.bufferHealth();
  }

  onEvent(listener: (event: ReticleEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Send a command to the browser and await its reply (or time out). */
  command(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<CommandResult> {
    // Recorded HERE rather than at the tool call sites: this is the one place every driven action
    // passes through, so act_sequence and flow replay count too. Doing it per-tool missed both, and
    // an under-counted "exercised" reports worse coverage than reality — the safe direction, but
    // still wrong, and it made the number depend on which tool the agent happened to use.
    if (name === ReticleCommand.ACT) {
      const ref = args['ref'];
      if (typeof ref === 'string') this.recordActedRef(ref);
    }
    const id = this.#pending.nextId(COMMAND_ID_PREFIX);
    const payload = JSON.stringify({
      kind: MessageKind.COMMAND,
      id,
      sessionId: this.id,
      name,
      args,
    });
    // The timeout message is built LAZILY: health can change while a command is in flight, and the
    // diagnosis should describe the page as it was when the command actually gave up.
    const awaited = this.#pending.track(id, timeoutMs, () =>
      commandTimeoutMessage(name, timeoutMs, {
        url: this.url,
        hidden: this.#hidden,
        ...(this.#runtime === undefined ? {} : { runtime: this.#runtime }),
      }),
    );
    this.#socket.send(payload);
    return awaited;
  }

  handleResult(result: CommandResult): void {
    this.#pending.settle(result);
  }

  /** Reject everything still in flight — used on disconnect. */
  rejectAll(reason: string): void {
    this.#pending.rejectAll(reason);
  }

  /** End this transport without letting a stale socket remove its replacement session. */
  disconnect(reason: string): void {
    this.rejectAll(reason);
    try {
      this.#socket.close(1008, reason);
    } catch {
      // A fake or already-closed socket needs no further cleanup.
    }
  }

  // ── Live-control: state machine + human→agent inbox (server-owned) ───────────────

  getState(): SessionState {
    return this.#live.state();
  }

  isPaused(): boolean {
    return this.#live.isPaused();
  }

  isEnded(): boolean {
    return this.#live.isEnded();
  }

  /**
   * Set the lifecycle state and echo it to the panel in ONE PRESENTER push. The SOLE pusher of
   * PRESENTER for a transition. Optional `text` rides the same push (e.g. an end-of-session
   * summary) so a transition never emits two PRESENTER commands.
   */
  setState(next: SessionState, text?: string, tone?: PresenterTone): void {
    this.#live.setState(next);
    this.pushPresenter(next, text, tone);
  }

  /** Push a human note onto the inbox (see LiveControl). */
  pushMessage(text: string): void {
    this.#live.push(text, this.elapsed());
  }

  /** Queued human notes, cleared as they are read (delivered-once). */
  drainInbox(): InboxMessage[] {
    return this.#live.drain();
  }

  /** Diagnostic read of the inbox depth (does not clear). */
  inboxSize(): number {
    return this.#live.size();
  }

  // ── Human review marks: the "annotate the bug where you see it" inbox (server-owned) ──────────

  /** Human marks still awaiting a fix (oldest first). Reading does not consume — resolveMark does. */
  pendingMarks(): ReviewMark[] {
    return this.#review.pending();
  }

  /** Full mark history (pending + resolved), oldest first. */
  allMarks(): ReviewMark[] {
    return this.#review.all();
  }

  /** Count of pending marks — surfaced as the panel badge / a session-health hint. */
  pendingMarkCount(): number {
    return this.#review.pendingCount();
  }

  /** Retire a mark the agent fixed. True on a real pending → resolved transition; false otherwise. */
  resolveMark(id: string): boolean {
    return this.#review.resolve(id);
  }

  /**
   * Apply a narrowed human control. LiveControl decides the transition; this applies it, so a real
   * change pushes exactly one PRESENTER command and a no-op pushes none.
   */
  applyHumanControl(data: HumanControlData): void {
    const next = this.#live.nextStateFor(data);
    if (next !== undefined) this.setState(next);
    if (data.kind === HumanControlKind.MESSAGE && data.text !== undefined) {
      this.pushMessage(data.text);
    }
  }

  /**
   * Push a lifecycle state to the panel with optional human-facing `text`. State changes still flow
   * through `setState`; an auto-ended session rides a `warn` tone so the panel can shout "agent stopped".
   */
  pushPresenter(state: SessionState, text?: string, tone?: PresenterTone): void {
    this.#post(ReticleCommand.PRESENTER, buildPresenterArgs(state, text, tone));
  }
  /** Fire-and-forget a narration row to the live panel (so a resolved mark shows "✓ fixed"). */
  pushNarration(text: string): void {
    this.#post(ReticleCommand.NARRATE, { text, level: 'info' });
  }

  /**
   * Returns the one-time session lease block on the very first agent command, then undefined
   * forever after. The lease carries an IMPORTANT reminder to call reticle_end_session. Coding agents
   * (Claude Code, Codex) read tool results — they will see this and remember to clean up.
   */
  takeSessionLease(): { sessionId: string; opened_at: number; IMPORTANT: string } | undefined {
    if (this.#firstCommandDone) return undefined;
    this.#firstCommandDone = true;
    return {
      sessionId: this.id,
      opened_at: this.#startedAt,
      IMPORTANT:
        'MANDATORY: the moment you stop driving — finishing a reply or waiting on the human — call reticle_session {action:"yield", mode:"waiting"} (or mode:"ask" with your question) so the panel never falsely reads "live". Call reticle_session {action:"end"} only when the whole task is done. The session revives on your next action.',
    };
  }

  /**
   * Returns a human-readable age warning after SESSION_LEASE.WARN_AFTER_MS (10 min), else undefined.
   * Spliced onto every session-bound tool result so the agent is passively reminded to clean up
   * without needing an explicit polling loop.
   */
  ageWarning(): string | undefined {
    const ageMs = this.#clock() - this.#startedAt;
    if (ageMs < SESSION_LEASE.WARN_AFTER_MS) return undefined;
    const minutes = Math.floor(ageMs / 60_000);
    return `Session ${this.id} has been open for ${String(minutes)} minutes. If your task is complete, call reticle_end_session now.`;
  }

  /** Fire-and-forget command send — NOT registered in #pending (no correlated result expected). */
  #post(name: string, args: Record<string, unknown>): void {
    if (this.#socket.readyState !== WS_OPEN) return;
    // Shares the same counter as tracked commands, so a fire-and-forget id can never collide with
    // one that IS awaiting a reply.
    // Recorded HERE rather than at the tool call sites: this is the one place every driven action
    // passes through, so act_sequence and flow replay count too. Doing it per-tool missed both, and
    // an under-counted "exercised" reports worse coverage than reality — the safe direction, but
    // still wrong, and it made the number depend on which tool the agent happened to use.
    if (name === ReticleCommand.ACT) {
      const ref = args['ref'];
      if (typeof ref === 'string') this.recordActedRef(ref);
    }
    const id = this.#pending.nextId(COMMAND_ID_PREFIX);
    const payload = JSON.stringify({
      kind: MessageKind.COMMAND,
      id,
      sessionId: this.id,
      name,
      args,
    });
    try {
      this.#socket.send(payload);
    } catch {
      // A closing/closed tab must never break event routing for the session.
    }
  }
}

/**
 * Re-exported from session-manager.ts so the public import path (`./session.js`) is unchanged for
 * the many call sites that resolve a target session. The class lives in its own file to keep both
 * units under the file-size cap.
 */
export { SessionManager } from './session-manager.js';
