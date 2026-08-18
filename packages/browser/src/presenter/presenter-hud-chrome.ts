/** Shared polished-black surfaces used across HUD chrome panels. */

export const HUD_SURFACE_CLASS = 'reticle-hud-surface';

/** Layered near-black base — no embedded image assets. */
export const HUD_SURFACE_FILL = `linear-gradient(165deg,#121218 0%,#09090c 42%,#000 100%)`;

export const HUD_SURFACE_PAINT = `background:${HUD_SURFACE_FILL};box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 0 0 1px rgba(255,255,255,.09);`;

export const HUD_DROP_SHADOW = '0 16px 40px rgba(0,0,0,.58),0 0 0 1px rgba(255,255,255,.08)';

export const HUD_CHROME_CSS = `
.${HUD_SURFACE_CLASS}{
  position:relative;overflow:hidden;
  contain:layout style paint;
  ${HUD_SURFACE_PAINT}
}
.${HUD_SURFACE_CLASS}::before,
[data-reticle-hud] .reticle-hud-deco::after{
  content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:1;
  background:
    radial-gradient(ellipse 120% 70% at 50% -18%,rgba(255,255,255,.07),transparent 52%),
    linear-gradient(180deg,rgba(255,255,255,.035) 0%,transparent 36%,rgba(0,0,0,.12) 100%);
}
.${HUD_SURFACE_CLASS} > *{position:relative;z-index:2;}`;

/** Inset well for the activity log — sits inside the chat card. */
export const HUD_LOG_WELL_CLASS = 'reticle-hud-log-well';

export const HUD_LOG_WELL_CSS = `
.${HUD_LOG_WELL_CLASS}{
  position:relative;flex:1;min-height:0;overflow:hidden;
  contain:layout style paint;
  margin:0 8px;border-radius:12px;
  background:
    radial-gradient(ellipse 90% 60% at 50% 0%,rgba(255,255,255,.028),transparent 55%),
    linear-gradient(180deg,rgba(0,0,0,.4) 0%,rgba(0,0,0,.68) 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 0 0 1px rgba(255,255,255,.06);
}
.${HUD_LOG_WELL_CLASS} > *{position:relative;z-index:1;}`;
