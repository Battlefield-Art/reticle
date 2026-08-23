import { describe, it, expect } from 'vitest';
import { buildServerInstructions } from './server-instructions.js';

/**
 * The instructions string is the only channel that reaches an agent with no skill file, no restart
 * and no action from the user — so what it leads with is the product's real first impression.
 *
 * It used to open on tool grammar, which is the right thing to say to an agent that has an app to
 * point the tools at and the wrong thing to say to one that does not. The overwhelming majority of
 * daemons in the field never see an app connect, never run a command and never call a tool: the
 * step being missed is not a hard one, it is one nobody was ever asked to take.
 */
describe('buildServerInstructions', () => {
  describe('when no app has ever connected to this project', () => {
    const text = buildServerInstructions({ previouslyConnected: false });

    it('leads with instrumenting the app, not with the tool list', () => {
      const lead = text.slice(0, 400);
      expect(lead).toMatch(/not instrumented|no app/i);
      expect(lead).toContain('init');
      // The tool grammar must not be the first thing an agent with no app reads.
      expect(lead).not.toContain('reticle_snapshot');
    });

    it('names the command to run and how to confirm it worked', () => {
      expect(text).toContain('init');
      expect(text).toContain('reticle_sessions');
    });

    it('still carries the verdict discipline and the feedback ask', () => {
      expect(text).toContain('reticle_act_and_wait');
      expect(text).toContain('reticle_feedback');
    });
  });

  describe('when an app has connected to this project before', () => {
    const text = buildServerInstructions({ previouslyConnected: true });

    it('does not open by telling a wired project to run init', () => {
      expect(text.slice(0, 400)).not.toContain('init');
    });

    it('leads with what the tools are for', () => {
      expect(text.slice(0, 200)).toContain('reticle_snapshot');
    });

    it('keeps the verdict discipline and the feedback ask', () => {
      expect(text).toContain('reticle_act_and_wait');
      expect(text).toContain('reticle_feedback');
    });

    /**
     * Both tools sit on the EXTENDED surface, so neither appears in the list an agent is handed by
     * default. Named nowhere, they are built and unreachable — an agent connecting today cannot
     * learn they exist, which makes their effect size zero whatever the engineering behind them.
     * This is the only channel that reaches an agent that never read the skill file.
     */
    it('names the two tools an agent would otherwise never learn exist', () => {
      expect(text).toContain('reticle_context');
      expect(text).toContain('reticle_intent');
    });

    /**
     * Naming them was half a fix. Neither is advertised, so a bare name sent an agent at a tool
     * `tools/list` does not contain: it burns a call, gets "unknown tool", and learns that the
     * instructions cannot be trusted — which is more expensive than never having been told.
     */
    it('gives both of them the reticle_run call that actually reaches them', () => {
      expect(text).toContain('reticle_run({ tool: "reticle_context"');
      expect(text).toContain('reticle_run({ tool: "reticle_intent"');
    });
  });

  it('stays short enough to be read in full, in both states', () => {
    // Every connected agent pays this in every session. A first move nobody finishes reading is
    // not a first move.
    //
    // Raised from 2,600 to admit the shared-argument vocabulary, and only that. The budget it buys
    // back is real and one-sided: those three arguments were documented identically on sixteen
    // tools, costing 1,367 bytes of the surface RE-SENT EVERY TURN, against 300-odd bytes here
    // charged once. Anything added beyond that has to make the same argument — a paragraph that is
    // not replacing per-turn repetition is just a longer preamble, and the reason for the cap is
    // attention, not bytes.
    //
    // Raised again to 3,200 for the reach-for block, which makes that argument in a second form.
    // Four advertised tools (observe, wait_for, inspect, session) were re-sent in full on EVERY
    // turn as part of the ~18 KB surface and explained nowhere, so the model had schemas it could
    // use and no basis on which to choose — and the measured cost of that on observe alone was
    // triple the false alarms. Roughly 600 bytes charged once, to make several KB per turn
    // reachable, is the same trade with the numbers in the same direction. The first-run state,
    // where a longer preamble would do the most harm, is unchanged but for two tool names.
    for (const previouslyConnected of [true, false]) {
      expect(buildServerInstructions({ previouslyConnected }).length).toBeLessThan(3200);
    }
  });
});
