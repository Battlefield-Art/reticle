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
    return this.#readLines(journalEventsPath(this.#root, this.#sessionId), ReticleEventSchema);
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
