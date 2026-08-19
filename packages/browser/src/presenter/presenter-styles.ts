import { LOG_CSS } from './presenter-log.js';
import { CONTROLS_CSS } from './presenter-controls.js';
import { SHELL_CSS } from './presenter-shell-styles.js';
import { SETTINGS_CSS } from './presenter-settings-styles.js';
import { HUD_CHROME_CSS, HUD_LOG_WELL_CSS } from './presenter-hud-chrome.js';
/**
 * All presenter overlay CSS - glow border, synthetic cursor/ring/ripple, and the floating HUD shell.
 * Split across shell-styles + controls + log modules so each file stays under the size cap.
 */
export const PRESENTER_CSS = `
[data-reticle-overlay]{position:fixed;inset:0;pointer-events:none;z-index:2147483600;}
[data-reticle-glow]{position:fixed;inset:0;pointer-events:none;z-index:2147483600;opacity:0;
  transition:opacity .25s ease;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);}
[data-reticle-glow][data-on="1"]{opacity:1;}
[data-reticle-glow][data-on="1"][data-busy="1"]{box-shadow:inset 0 0 0 2px rgba(255,255,255,.28);}
[data-reticle-cursor]{position:fixed;top:0;left:0;width:20px;height:20px;margin:-10px 0 0 -10px;
  border:2px solid #fafafa;border-radius:50%;background:rgba(255,255,255,.12);pointer-events:none;
  z-index:2147483646;opacity:0;transition:transform .32s cubic-bezier(.22,1,.36,1),opacity .2s ease;}
[data-reticle-cursor][data-on="1"]{opacity:1;}
[data-reticle-cursor]::after{content:"";position:absolute;inset:6px;border-radius:50%;background:#fafafa;}
[data-reticle-ripple]{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
  background:rgba(255,255,255,.35);pointer-events:none;z-index:2147483645;animation:reticle-ripple .45s ease-out forwards;}
@keyframes reticle-ripple{from{transform:scale(.5);opacity:.7}to{transform:scale(4);opacity:0}}
[data-reticle-ring]{position:fixed;pointer-events:none;z-index:2147483644;border:1px solid rgba(255,255,255,.55);border-radius:6px;
  box-shadow:none;opacity:0;transition:opacity .15s ease;}
[data-reticle-ring][data-on="1"]{opacity:1;}
[data-reticle-mode="reading"] [data-reticle-glow][data-on="1"]{box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);}
[data-reticle-mode="reading"] [data-reticle-ring]{border-color:rgba(255,255,255,.7);box-shadow:none;}
[data-reticle-overlay][data-reticle-throttled="1"] [data-reticle-glow][data-on="1"]{
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.18);}
[data-reticle-overlay] .reticle-hi-icon,
[data-reticle-overlay] .reticle-sl-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0;color:inherit;overflow:visible;}
[data-reticle-overlay] .reticle-hi-icon svg,
[data-reticle-overlay] .reticle-sl-icon svg{display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;overflow:visible;}
${HUD_CHROME_CSS}
${HUD_LOG_WELL_CSS}
${SHELL_CSS}
${SETTINGS_CSS}
${LOG_CSS}
${CONTROLS_CSS}`;
