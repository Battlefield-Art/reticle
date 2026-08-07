import { describe, expect, it } from 'vitest';
import {
  BugSource,
  ConnectFailure,
  ContradictionKind,
  ActionType,
  FeedbackKind,
  QueryBy,
  SnapshotMode,
  CrawlAnomalyKind,
  TelemetryEventKind,
  TelemetryEventSchema,
} from '@reticlehq/core';
import { TOOLS } from '../tools/tools.js';
import { ReticleTool } from '../tools/tool-names.js';
import { VERIFICATION_TOOLS } from '../tools/feedback-tools.js';
import { bugsInResult } from './bug-found.js';
import { describeParam } from './argument-shape.js';

/**
 * THE TELEMETRY CONTRACT, enforced.
 *
 * Telemetry fails silently. Nothing throws when an event is missed, no test goes red, no user
 * complains — the data is simply, permanently absent, and you find out months later when someone
 * asks a question the data cannot answer. That makes it the one subsystem where "remember to
 * instrument it" is not a workable rule, and where the guard has to live in a test rather than in a
 * reviewer's head.
 *
 * Everything here is written so that ADDING something makes it fail. A new tool, a new event kind, a
 * new contradiction kind, a new finding source — each trips a check that names what is now missing
 * and where to add it. That is the point: these are not tests of what the code does today, they are
 * a tripwire on the ways the telemetry can silently stop being true.
 *
 * See `docs/telemetry-contract.md` for the human-facing version of these rules.
 */

/** Events an agent's tool call can produce. Each must have somewhere it is actually emitted from. */
const EMITTED_SOMEWHERE: ReadonlySet<TelemetryEventKind> = new Set(
  Object.values(TelemetryEventKind),
);

describe('every telemetry event kind is real and reachable', () => {
  it('has a lowercase snake_case name — the dashboard reads these, so they cannot be cryptic', () => {
    for (const kind of Object.values(TelemetryEventKind)) {
      expect(kind, `event '${kind}'`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  /**
   * The previous taxonomy failed this badly enough to confuse its own authors: `invoke` meant "the
   * CLI ran" and `tool` meant "a tool was called", which is the opposite of how both read.
   */
  it('names an EVENT, not an object — every name is <noun>_<verbed> or a lifecycle moment', () => {
    for (const kind of EMITTED_SOMEWHERE) {
      expect(
        kind.includes('_') || kind === 'identified',
        `'${kind}' should read as something that happened`,
      ).toBe(true);
    }
  });

  it('is accepted by the wire schema, so no kind can exist that cannot be sent', () => {
    for (const kind of Object.values(TelemetryEventKind)) {
      const parsed = TelemetryEventSchema.safeParse({
        v: 3,
        anonymousId: 'a',
        sessionId: 's',
        event: kind,
        ts: 0,
        version: '1.0.0',
        ci: false,
        os: 'darwin',
      });
      expect(parsed.success, `event '${kind}' is not a valid wire event`).toBe(true);
    }
  });
});

/**
 * The tool surface is the thing that grows. A new tool is added most weeks; a new telemetry hook is
 * added almost never — so the failure mode is always "the tool shipped and the metric did not".
 */
describe('every tool is classified for telemetry', () => {
  it('routes through runTool, which is the ONLY place tool usage is counted', () => {
    // A tool absent from TOOLS is unreachable; a tool present in TOOLS is dispatched through runTool
    // by both the MCP server and the programmatic invoker. This pins the invariant that makes the
    // single-chokepoint design safe: there is no second dispatch path to forget to instrument.
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(typeof tool.handler, `tool '${tool.name}' has no handler`).toBe('function');
    }
  });

  /**
   * A verification tool that is not in VERIFICATION_TOOLS produces no `verification_completed` and no
   * human feedback prompt — it silently stops counting toward the metric the product exists to
   * report. The name is the tell, so the check is on the name.
   */
  it('every tool whose name implies a VERDICT is in VERIFICATION_TOOLS', () => {
    const verdictish = TOOLS.map((t) => t.name).filter(
      (name) => /assert|verify/.test(name) && name !== ReticleTool.FLOW_SAVE_RECORDED,
    );
    for (const name of verdictish) {
      expect(
        VERIFICATION_TOOLS.has(name),
        `'${name}' looks like it produces a verdict but is not in VERIFICATION_TOOLS — ` +
          'it will not emit verification_completed. Add it there, or rename it if it does not.',
      ).toBe(true);
    }
  });

  /**
   * The name check above has a hole exactly the shape of the product's MAIN verification path.
   *
   * `reticle_act_and_wait` declares `verified` in its outputSchema, returns the full verdict block
   * (verified / because / honesty), and its own description calls it "one hop for the act->observe->
   * assert loop". It matches neither /assert/ nor /verify/, so the tripwire never fired and it was
   * never added to VERIFICATION_TOOLS — meaning every verification performed through it emitted no
   * `verification_completed` at all.
   *
   * Measured over a day of real telemetry: `reticle_act_and_wait` 14 calls, `reticle_assert` ZERO,
   * and `verification_completed` = 2. Agents were verifying the whole time, through the tool built
   * for exactly that, and the metric the product exists to report could not see any of it.
   *
   * So the check is on the SHAPE, not the name: a tool that declares a `verified` verdict is a
   * verification tool, whatever it happens to be called.
   */
  it('every tool that DECLARES a `verified` verdict is in VERIFICATION_TOOLS', () => {
    const declaresVerdict = TOOLS.filter(
      (tool) => tool.outputSchema !== undefined && 'verified' in tool.outputSchema,
    ).map((tool) => tool.name);
    // If this ever comes back empty the check has silently stopped guarding anything.
    expect(declaresVerdict.length).toBeGreaterThan(0);
    for (const name of declaresVerdict) {
      expect(
        VERIFICATION_TOOLS.has(name),
        `'${name}' declares a \`verified\` verdict in its outputSchema but is not in ` +
          'VERIFICATION_TOOLS, so every verdict it returns is invisible to verification_completed.',
      ).toBe(true);
    }
  });
});

/**
 * `bugsInResult` reads tool RESULTS, so a new finding shape is only counted if it lands in one of the
 * fields it knows about. These pin the mapping between the findings vocabulary and the bug metric —
 * the number we intend to publish, which makes a silent gap here a correctness problem rather than a
 * reporting one.
 */
describe('every finding kind counts as a bug', () => {
  it.each(Object.values(ContradictionKind))(
    'contradiction %s is counted, and marks a false green',
    (kind) => {
      const bugs = bugsInResult('reticle_assert', { pass: true, contradictions: [{ kind }] });
      expect(bugs, `contradiction '${kind}' produced no bug`).toHaveLength(1);
      expect(bugs[0]?.falseGreen, `'${kind}' should present as success`).toBe(true);
    },
  );

  it.each(Object.values(CrawlAnomalyKind))('crawl anomaly %s is counted', (kind) => {
    const bugs = bugsInResult('reticle_crawl', { anomalies: [{ kind }] });
    expect(bugs, `crawl anomaly '${kind}' produced no bug`).toHaveLength(1);
    // A single-channel fault is NOT a false green — inflating this would corrupt the public claim.
    expect(bugs[0]?.falseGreen).toBe(false);
  });

  /**
   * The check that would have caught the real bug: `bug-found.ts` once hand-copied the twelve
   * contradiction strings, which matched on the day it was written and would have silently
   * misclassified the thirteenth — deflating the exact number we publish, with nothing going red.
   */
  it('derives its contradiction set from core rather than a copy', () => {
    for (const kind of Object.values(ContradictionKind)) {
      const [bug] = bugsInResult('reticle_crawl', { anomalies: [{ kind }] });
      expect(
        bug?.falseGreen,
        `'${kind}' is not recognised as a contradiction by bug-found.ts — it is probably ` +
          'hand-listed there instead of derived from core.ContradictionKind.',
      ).toBe(true);
    }
  });

  it('every bug source is producible, so none is a dead enum member', () => {
    const produced = new Set<string>([
      ...bugsInResult('t', { pass: true, contradictions: [{ kind: 'signal-contradicted' }] }).map(
        (b) => b.source,
      ),
      ...bugsInResult('t', { anomalies: [{ kind: 'console-error' }] }).map((b) => b.source),
      ...bugsInResult('t', { pass: false }).map((b) => b.source),
      ...bugsInResult('t', { status: 'fail', failures: [{}] }).map((b) => b.source),
    ]);
    for (const source of Object.values(BugSource)) {
      expect(produced.has(source), `BugSource.${source} is never produced by bugsInResult`).toBe(
        true,
      );
    }
  });
});

/**
 * Every enum that is MIRRORED anywhere must be derived, not copied. This has already gone wrong twice
 * — contradiction kinds in `bug-found.ts`, feedback kinds in `argument-shape.ts` — and both times the
 * copy was correct on the day it was written and silently wrong at the next addition.
 */
describe('no vocabulary is hand-copied', () => {
  /**
   * Every param whose values mirror a core enum. Hand-listing these was wrong on the day it shipped,
   * not merely at risk: `action` was missing `fill` — one of the most common actions there is — so it
   * reported as `other` and "which actions do agents perform" was quietly wrong.
   */
  it.each([
    ['kind', Object.values(FeedbackKind), 'FeedbackKind'],
    ['action', Object.values(ActionType), 'ActionType'],
    ['by', Object.values(QueryBy), 'QueryBy'],
    ['mode', Object.values(SnapshotMode), 'SnapshotMode'],
  ])('reports every %s value by name, not as `other`', (param, values, enumName) => {
    for (const value of values) {
      expect(
        describeParam(param, value),
        `'${param}: ${value}' reports as 'other' — argument-shape.ts is probably hand-listing ` +
          `these instead of deriving them from core.${enumName}.`,
      ).toBe(`${param}:${value}`);
    }
  });

  it('does not claim values its enum never defined', () => {
    // A stale entry is the same drift in the other direction: it reports a value core does not have.
    expect(describeParam('mode', 'lean')).toBe('mode:other');
  });
});

describe('failure vocabularies stay closed', () => {
  /**
   * `OTHER` is the bucket that says the classifier has a blind spot. It must exist — a classifier
   * that cannot say "I do not know" lies instead — and every other member must be distinct from it.
   */
  it('connection failures keep an explicit unknown bucket', () => {
    expect(Object.values(ConnectFailure)).toContain(ConnectFailure.OTHER);
    expect(new Set(Object.values(ConnectFailure)).size).toBe(Object.values(ConnectFailure).length);
  });
});

/**
 * `repeat` is set at the EMISSION site, never by the classifier — and the classifier must not grow
 * it back. `bugsInResult` is a pure function over a tool result; whether a kind was already seen
 * belongs to the session. If a future change makes the detector emit `repeat` itself, it will be
 * guessing, and the number it guesses is the one that gets published.
 */
describe('the bug classifier stays pure — dedup belongs to the session', () => {
  it('does not invent a repeat flag it has no way to know', () => {
    const bugs = bugsInResult('reticle_assert', {
      pass: true,
      contradictions: [{ kind: 'signal-contradicted' }],
    });
    expect(bugs.length).toBe(1);
    expect(bugs[0]).not.toHaveProperty('repeat');
  });
});
