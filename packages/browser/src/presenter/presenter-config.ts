import { type ControlHandler } from './presenter-controls.js';

/**
 * Presenter tunables + option surface. Split out of presenter.ts so that file is just the controller
 * under the size cap; these are pure declarations (interfaces + named constants), no behavior. None
 * cross the browser↔bridge↔agent wire, so they live here, not in @reticlehq/core.
 */

/**
 * Border behavior.
 * - 'session': base border persists connect→disconnect; the busy machine drives only the shimmer.
 * - 'busy': back-compat — the busy machine toggles the base border on/off.
 */
export const BorderMode = { SESSION: 'session', BUSY: 'busy' } as const;
export type BorderMode = (typeof BorderMode)[keyof typeof BorderMode];
export const DEFAULT_BORDER_MODE: BorderMode = BorderMode.SESSION;
export const DATA_BUSY = 'data-busy';
export const BUSY_ON = '1';
export const BUSY_OFF = '0';

export interface PresenterOptions {
  paceMs?: number;
  /** Injected monotonic clock for the glow state machine (tests drive transitions). */
  now?: () => number;
  /** Quiet window before busy -> fading. Overridable so tests run fast. */
  idleAfterMs?: number;
  /** Fade duration before fading -> idle (keep in sync with the glow CSS opacity transition). */
  glowFadeMs?: number;
  /** Liveness heartbeat interval (ms). Overridable so tests run fast. */
  heartbeatMs?: number;
  /** Quiet (ms) after which the act strip shows the live "idle · {duration}" clock. Test-overridable. */
  idleNoticeMs?: number;
  /** Quiet (ms) after which the session AUTO-ENDS (glow off, panel kept). Default 5min; agent-tunable. */
  idleEndMs?: number;
  /** Session id, surfaced in the exported run state. */
  sessionId?: string;
  /** Deprecated: accepted for source compat; the live log no longer auto-expires. */
  narrationDwellMs?: number;
  /**
   * 'session' (default): base border persists connect→disconnect, busy machine drives only the
   * shimmer. 'busy': back-compat — busy machine toggles the base border on/off.
   */
  border?: BorderMode;
  /** Max accumulated activity-log rows before the oldest are pruned. Default 50. */
  logMax?: number;
  /** Called when the human clicks pause/resume/end or sends a message from the panel. */
  onControl?: ControlHandler;
  /** Overridable ended-border fade delay (native timer). Default 4000. */
  endedFadeMs?: number;
}

export const DEFAULT_PACE = 450;

/**
 * The pace to actually use: the default in a browser a human is watching, zero in an automated one.
 *
 * The HUD paces `beforeAct` so a person can see the cursor reach the element before it fires. In a
 * headless browser that is 450ms of nothing, charged to the agent, on every action. Measured with
 * RETICLE_TRACE across the e2e battery: 42 `act` round-trips, 40 of them in a 452–460ms band —
 * a fixed cost, not app work — 19.7 SECONDS in total, 98.5% of all time the battery spent in the
 * browser, while every other command ran in 1–4ms.
 *
 * `navigator.webdriver` is the discriminator because it is exactly the question being asked: true
 * under automation (Playwright, CDP, the browser pool's leased tabs, CI), false in the dev browser
 * a human has open — the case the HUD exists for, which keeps its pacing untouched.
 *
 * An EXPLICIT `paceMs` always wins: a recorded demo runs under automation and still wants the glide,
 * and an option that quietly ignores what the caller asked for is worse than no option.
 */
export function effectivePaceMs(
  requested: number | undefined,
  nav: Navigator | undefined = 'undefined' === typeof navigator ? undefined : navigator,
): number {
  if (requested !== undefined) return requested;
  return true === nav?.webdriver ? 0 : DEFAULT_PACE;
}

/**
 * Glow state machine phases (exposed via glowPhase for tests). A burst of activity flips the
 * border IN once on the first activity, holds steady (the slow reticle-pulse breathing keeps running
 * uninterrupted — no per-action restart/strobe), then fades OUT once after a quiet window.
 */
export const GlowPhase = {
  IDLE: 'idle',
  BUSY: 'busy',
  FADING: 'fading',
} as const;
export type GlowPhase = (typeof GlowPhase)[keyof typeof GlowPhase];

/** Quiet window before busy -> fading. */
export const IDLE_AFTER_MS = 700;
/** Liveness heartbeat: how often the act strip refreshes its "idle · {duration}" clock. */
export const HEARTBEAT_MS = 1000;
/**
 * After this much quiet, the act strip stops showing the last action and starts a LIVE, ticking
 * "◌ idle · {duration} since last action" — so a watcher can tell a 3s think from a dead agent
 * (the killer gap: a frozen panel used to look identical whether the agent paused or stopped).
 */
export const IDLE_NOTICE_MS = 4000;
/** Default session-idle-end: after this much quiet the session auto-ends (glow off, panel persists
 * for analysis). Agent-tweakable via reticle_session { idleEndMs } for the app's needs. */
export const IDLE_END_MS = 300_000;
/** Floor for a tweaked idle-end so the agent can't set a uselessly tiny window. */
export const IDLE_END_MIN_MS = 5_000;
/** Must match the glow CSS opacity transition.25s) so phase reaches idle after the fade paints. */
export const GLOW_FADE_MS = 250;
export const GLOW_ON = '1';
export const GLOW_OFF = '0';
export const DATA_ON = 'data-on';
/** Overlay-root attribute toggled when the panel is minimised to a bar. */
export const MIN_ATTR = 'data-reticle-min';
export const THROTTLED_ATTR = 'data-reticle-throttled';
