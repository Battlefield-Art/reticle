import type { FileSystemPort } from '../project/fs-port.js';
import { isValidSessionId } from '../project/reticle-dir.js';
import { JournalRecorder } from './journal-recorder.js';
import { SessionJournal } from './session-journal.js';

/** The minimal Session surface the journal attachment needs (Session satisfies it structurally). */
export interface JournalTarget {
  readonly id: string;
  /** Milliseconds since the session connected — the recorder's injected clock. */
  elapsed(): number;
  setJournal(recorder: JournalRecorder): void;
}

export interface JournalAttachDeps {
  fs: FileSystemPort;
  reticleRoot: string;
  /** Journaling is on by default; the opt-out (`.reticle.json` journal:false / env) sets this false. */
  enabled: boolean;
}

/**
 * Build the per-session journal attachment the bridge fires on session creation. Off when disabled;
 * silently skips a session whose id is not a safe path segment (never crashes the live session over a
 * journaling concern). The recorder's clock is the session's own elapsed time.
 */
export function makeJournalAttach(deps: JournalAttachDeps): (session: JournalTarget) => void {
  return (session) => {
    if (!deps.enabled) return;
    if (!isValidSessionId(session.id)) return;
    const sink = new SessionJournal(deps.fs, deps.reticleRoot, session.id);
    session.setJournal(new JournalRecorder(sink, { now: () => session.elapsed() }));
  };
}
