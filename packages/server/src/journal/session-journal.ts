import type { z, ZodTypeAny } from 'zod';
import {
  JournalActionSchema,
  ReticleEventSchema,
  type JournalAction,
  type ReticleEvent,
} from '@reticlehq/core';
import type { FileSystemPort } from '../project/fs-port.js';
import {
  isValidSessionId,
  journalActionsPath,
  journalEventsPath,
  sessionDirPath,
} from '../project/reticle-dir.js';

/**
 * The durable per-session journal: append-only JSONL for events and actions, the ledger the ring
 * buffer becomes a hot cache over. Writes are batched (the caller flushes ring-buffer windows), so a
 * batch is one syscall — not one per event. Reads never throw: a missing file is `[]`, a malformed or
 * schema-invalid line is skipped, matching the never-throw discipline of the run store.
 *
 * Events are already browser-edge-redacted (network/storage/DOM) before they reach the wire, so the
 * journal stores redacted payloads; the ledger is local-only. A server-side second-pass event redactor
 * is defense-in-depth for a later commit, not a correctness gate here.
 *
 * ponytail: append-per-batch, no retention yet. Bounded-disk pruning (cap session dirs / file size,
 * "pruned like runs/") is a dedicated follow-up — see the build ledger. Perf ceiling: if the <3%
 * main-thread overhead budget is threatened at high event rates, coalesce batches behind a flush timer.
 */
export class SessionJournal {
  readonly #fs: FileSystemPort;
  readonly #root: string;
  readonly #sessionId: string;
  #dirEnsured = false;
  // Parse-cache for the append-only EVENTS journal. queryEvents falls through to readEvents on every
  // observe/network/console call once the ring buffer has evicted (permanent ~60s into any session), so
  // a naive readEvents re-read + re-JSON.parse + re-zod-validated the WHOLE file each time — measured at
  // a 1-hour 100 ev/s session as ~1.5s CPU + ~300MB transient heap PER tool call, growing with age. The
  // journal only ever grows and is always a run of complete '\n'-terminated lines, so we keep the parsed
  // events and the char count already consumed, and parse only the tail written since the last read.
  #eventCache: ReticleEvent[] | undefined;
  #eventCharsConsumed = 0;

  constructor(fs: FileSystemPort, root: string, sessionId: string) {
    if (!isValidSessionId(sessionId)) {
      throw new Error(`refusing to journal an unsafe session id: ${sessionId}`);
    }
    this.#fs = fs;
    this.#root = root;
    this.#sessionId = sessionId;
  }

  async appendEvents(events: readonly ReticleEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.#ensureDir();
    const text = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
    await this.#fs.appendFile(journalEventsPath(this.#root, this.#sessionId), text);
  }

  async appendAction(action: JournalAction): Promise<void> {
    await this.#ensureDir();
    await this.#fs.appendFile(
      journalActionsPath(this.#root, this.#sessionId),
      `${JSON.stringify(action)}\n`,
    );
  }

  async readEvents(): Promise<ReticleEvent[]> {
    const path = journalEventsPath(this.#root, this.#sessionId);
    let text: string;
    try {
      text = await this.#fs.readFile(path);
    } catch (error) {
      if (this.#fs.isNotFound(error)) return (this.#eventCache ?? []).slice();
      throw error;
    }
    if (this.#eventCache === undefined) this.#eventCache = [];
    // Parse only what was appended since the last read. #eventCharsConsumed is always a line boundary
    // (every line is written with a trailing '\n'), so slicing there yields whole lines. If the file
    // somehow shrank (rotation/truncation — not done today, but be safe), fall back to a full reparse.
    if (text.length < this.#eventCharsConsumed) {
      this.#eventCache = [];
      this.#eventCharsConsumed = 0;
    }
    if (text.length > this.#eventCharsConsumed) {
      const fresh = text.slice(this.#eventCharsConsumed);
      for (const line of fresh.split('\n')) {
        if (line.length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const result = ReticleEventSchema.safeParse(parsed);
        if (result.success) this.#eventCache.push(result.data);
      }
      this.#eventCharsConsumed = text.length;
    }
    // A shallow copy preserves the fresh-array contract callers had (merge/sort own their input); it is
    // O(n) pointer copy, not the O(n) JSON.parse + validate that was the actual cost.
    return this.#eventCache.slice();
  }

  async readActions(): Promise<JournalAction[]> {
    return this.#readLines(journalActionsPath(this.#root, this.#sessionId), JournalActionSchema);
  }

  async #ensureDir(): Promise<void> {
    if (this.#dirEnsured) return;
    await this.#fs.mkdir(sessionDirPath(this.#root, this.#sessionId));
    this.#dirEnsured = true;
  }

  async #readLines<S extends ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>[]> {
    let text: string;
    try {
      text = await this.#fs.readFile(path);
    } catch (error) {
      if (this.#fs.isNotFound(error)) return [];
      throw error;
    }
    const out: z.infer<S>[] = [];
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const result = schema.safeParse(parsed);
      // Validated at this boundary; ZodTypeAny widens `.data` to any, so re-narrow to the schema output.
      if (result.success) out.push(result.data as z.infer<S>);
    }
    return out;
  }
}
