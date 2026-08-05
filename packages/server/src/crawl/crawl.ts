import {
  ActionType,
  CRAWL_DEFAULTS,
  CrawlAnomalyKind,
  ContradictionKind,
  DANGEROUS_ACTION_CONFIRM_ARG,
  EventType,
  ReticleCommand,
  type CommandResult,
  type ReticleEvent,
} from '@reticlehq/core';
import {
  parseInteractive,
  asRecord,
  asNumber,
  asString,
  sourceOf,
} from '../tools/tools-helpers.js';
import { ReticleTool } from '../tools/tool-names.js';
import { findContradictions } from '../events/contradictions.js';

/** The slice of Session the crawler needs — so tests inject a fake without a live browser. */
export interface CrawlSession {
  command(name: string, args?: Record<string, unknown>): Promise<CommandResult>;
  elapsed(): number;
  eventsSince(cursor: number): ReticleEvent[];
  /**
   * Attribution window around each click. Optional so a caller can supply a minimal session, but a real
   * session MUST provide it: without a window the click's own effects carry no actionId, and an
   * unattributed ref-bearing event is learned as ambient background churn. A crawl clicks up to 25
   * controls, so it can single-handedly teach the settle oracle to ignore the regions the app actually
   * reacts in — turning a later `{kind:"settled"}` into a false green.
   */
  beginAction?(tool: string, args: Record<string, unknown>): void;
  finishAction?(error?: string, settled?: boolean, settleMs?: number): void;
}

type CrawlSleep = (ms: number) => Promise<void>;

export interface CrawlAnomaly {
  /**
   * A single-channel fault (something bad in one stream) or a CONTRADICTION (two channels
   * disagreeing about the same click). The second kind is why an autonomous crawl is worth more
   * than a human clicking the same buttons: a person sees only the screen, so a UI that advanced
   * while its write failed looks like success to them and always will.
   */
  kind: CrawlAnomalyKind | ContradictionKind;
  /** The control that triggered it. */
  ref: string;
  desc: string;
  detail: string;
  /**
   * Where the control is written, as `file:line`.
   *
   * A crawl reports problems across a whole app, so it is the output most likely to be read as a
   * work list — and "e42 does nothing" is a work list item that starts with a search. The location
   * comes free: the crawl already clicks each control, and an act result carries the source captured
   * alongside its anchor. Absent in production builds and apps without the build plugin.
   */
  source?: string;
}

/** Said out loud when the page was larger than one snapshot, so a clean sweep cannot mean "all clear". */
export const CAPPED_SNAPSHOT_NOTE =
  'the page exceeded one snapshot, so controls past the cap were never seen — interactiveFound is a floor, not a total; re-run with a narrower `scope` to cover the rest';

export interface CrawlReport {
  interactiveFound: number;
  stepsRun: number;
  anomalies: CrawlAnomaly[];
  counts: {
    consoleErrors: number;
    failedRequests: number;
    deadControls: number;
    contradictions: number;
  };
  /** Descriptions of the controls actually clicked. */
  visited: string[];
  /** True when coverage was bounded — by the step budget, or by the page exceeding one snapshot. */
  truncated: boolean;
  /** Present only when the snapshot itself was capped, i.e. controls exist that were never listed. */
  coverageNote?: string;
}

export interface CrawlOptions {
  maxSteps?: number;
  settleMs?: number;
  scope?: string;
  confirmDangerous?: boolean;
}

/** Any buffer event that proves the app reacted to a click (vs a dead/no-op control). */
function isActivity(e: ReticleEvent): boolean {
  return (
    e.type === EventType.NET_REQUEST ||
    e.type === EventType.DOM_ADDED ||
    e.type === EventType.DOM_REMOVED ||
    e.type === EventType.DOM_ATTR ||
    e.type === EventType.DOM_TEXT ||
    e.type === EventType.ROUTE_CHANGE ||
    e.type === EventType.SIGNAL ||
    e.type === EventType.ANIM_START ||
    e.type === EventType.ANIM_END
  );
}

function isConsoleError(e: ReticleEvent): boolean {
  return e.type === EventType.CONSOLE_ERROR || e.type === EventType.ERROR_UNCAUGHT;
}

function failedRequests(events: ReticleEvent[], floor: number): ReticleEvent[] {
  return events.filter((e) => {
    if (e.type !== EventType.NET_REQUEST) return false;
    const status = asNumber(e.data['status']);
    return status !== undefined && status >= floor;
  });
}

/**
 * The autonomous "smart monkey". Discovers every reachable interactive control once,
 * then clicks each (bounded by maxSteps) and classifies the reaction into anomalies — console
 * errors, failed requests, and DEAD controls (dispatched but the app did nothing). Pure
 * orchestration over a CrawlSession: no browser/Node imports, fully unit-testable with a fake.
 * Single-pass by design (no re-discovery) so it always terminates and never explodes on navigation.
 */

/**
 * Controls whose correct behaviour IS to do nothing when clicked.
 *
 * Read off the same descriptor the crawler already has, so no extra round trip: `[disabled]` is inert
 * by definition, an already `[checked]` radio/checkbox is idempotent, and clicking a text field
 * focuses it rather than changing anything.
 */
export function legitimatelyInert(desc: string): boolean {
  if (desc.includes('[disabled]')) return true;
  if (desc.includes('[checked]')) return true;
  return /\b(textbox|searchbox|combobox|spinbutton)\b/.test(desc);
}

export async function crawl(
  session: CrawlSession,
  opts: CrawlOptions,
  sleep: CrawlSleep,
): Promise<CrawlReport> {
  const maxSteps = opts.maxSteps ?? CRAWL_DEFAULTS.MAX_STEPS;
  const settleMs = opts.settleMs ?? CRAWL_DEFAULTS.SETTLE_MS;

  const snap = await session.command(ReticleCommand.SNAPSHOT, {
    mode: 'interactive',
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
  });
  const snapshot = snap.ok ? ((snap.result ?? {}) as { tree?: string; truncated?: boolean }) : {};
  const tree = snapshot.tree ?? '';
  const items = parseInteractive(tree);
  // The snapshot walk stops at its node cap and returns a DOCUMENT-ORDER PREFIX, so on a large page
  // the controls it never reached are not merely unclicked — they were never seen. Reporting
  // `interactiveFound` without this would state a control count that is really a cap, and
  // `truncated:false` would positively assert that nothing was cut.
  const coverageCapped = snapshot.truncated === true;

  const anomalies: CrawlAnomaly[] = [];
  const visited: string[] = [];
  const counts = { consoleErrors: 0, failedRequests: 0, deadControls: 0, contradictions: 0 };
  const seen = new Set<string>();

  let stepsRun = 0;
  for (const item of items) {
    if (stepsRun >= maxSteps) break;
    // Dedupe by ref (the unique element), not by label — two "Delete"/"Edit" controls share a desc
    // but are different controls; collapsing them by label under-covers list/table UIs.
    const dedupeKey = item.ref !== '' ? item.ref : item.desc;
    if (seen.has(dedupeKey)) continue; // don't re-click the same control
    seen.add(dedupeKey);
    stepsRun += 1;
    visited.push(item.desc);

    const since = session.elapsed();
    session.beginAction?.(ReticleTool.CRAWL, { ref: item.ref, action: ActionType.CLICK });
    let act;
    try {
      act = await session.command(ReticleCommand.ACT, {
        ref: item.ref,
        action: ActionType.CLICK,
        args: opts.confirmDangerous === true ? { [DANGEROUS_ACTION_CONFIRM_ARG]: true } : {},
      });
      await sleep(settleMs);
    } finally {
      // Close on every exit so a throw cannot leak the window onto the next control's events.
      session.finishAction?.();
    }
    const events = session.eventsSince(since);
    // Captured at act time, so it survives a click that unmounts its own control.
    const src = sourceOf(asRecord(act?.result)['source']);
    const source = src === undefined ? {} : { source: `${src.file}:${String(src.line)}` };

    const errs = events.filter(isConsoleError);
    for (const e of errs) {
      counts.consoleErrors += 1;
      anomalies.push({
        kind: CrawlAnomalyKind.CONSOLE_ERROR,
        ref: item.ref,
        desc: item.desc,
        detail: asString(e.data['message']) ?? e.type,
        ...source,
      });
    }

    for (const e of failedRequests(events, CRAWL_DEFAULTS.FAILED_STATUS)) {
      counts.failedRequests += 1;
      const method = asString(e.data['method']) ?? '';
      const url = asString(e.data['url']) ?? '';
      const status = asNumber(e.data['status']);
      anomalies.push({
        kind: CrawlAnomalyKind.FAILED_REQUEST,
        ref: item.ref,
        desc: item.desc,
        detail: `${method} ${url} → ${status ?? ''}`.trim(),
        ...source,
      });
    }

    // CONTRADICTIONS: the channels disagree about what this click did. Reported per control, so a
    // crawl of an unknown app surfaces its false greens without anyone knowing where to look.
    for (const c of findContradictions(events)) {
      counts.contradictions += 1;
      anomalies.push({
        kind: c.kind,
        ref: item.ref,
        desc: item.desc,
        detail: `${c.claim}, but ${c.counter} — ${c.detail}`,
        ...source,
      });
    }

    // DEAD: the click dispatched but the app produced no activity and no error to explain it.
    //
    // Unless the control is SUPPOSED to be inert. Measured on a shipments console: every one of the
    // crawler's three anomalies was a control behaving correctly — a `[disabled]` button, an already
    // `[checked]` radio, and a text input (a click focuses it; mutating would be the surprise). An
    // anomaly list that is 100% false on a real app is worse than no anomaly list, because the agent
    // spends its budget disproving it and learns to skip the field.
    //
    // Deliberately NOT fixed by counting focus as activity: focus moving is not the app reacting, and
    // treating it as such would make a genuinely dead button that takes focus look alive — trading
    // noise for the false negative this check exists to catch.
    const dispatched = asRecord(act.result)['dispatched'] !== false && act.ok;
    if (
      dispatched &&
      errs.length === 0 &&
      !events.some(isActivity) &&
      !legitimatelyInert(item.desc)
    ) {
      counts.deadControls += 1;
      anomalies.push({
        kind: CrawlAnomalyKind.DEAD_CONTROL,
        ref: item.ref,
        desc: item.desc,
        detail: 'clicked but the app did nothing (no DOM/network/route/signal change)',
        ...source,
      });
    }
  }

  return {
    interactiveFound: items.length,
    stepsRun,
    anomalies,
    counts,
    visited,
    // True when coverage was bounded for EITHER reason: the step budget ran out, or the page was
    // bigger than one snapshot. Conflating "I stopped early" with "I saw everything" is what turns a
    // partial sweep into "all controls healthy".
    truncated: items.length > stepsRun || coverageCapped,
    ...(coverageCapped ? { coverageNote: CAPPED_SNAPSHOT_NOTE } : {}),
  };
}
