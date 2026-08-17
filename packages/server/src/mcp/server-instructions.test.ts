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
  });

  it('stays short enough to be read in full, in both states', () => {
    // Every connected agent pays this in every session. A first move nobody finishes reading is
    // not a first move.
    for (const previouslyConnected of [true, false]) {
      expect(buildServerInstructions({ previouslyConnected }).length).toBeLessThan(2600);
    }
  });
});
