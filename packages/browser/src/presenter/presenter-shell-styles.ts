/**
 * Floating HUD shell styles - FAB, morphing toolbar, and agent chat panel.
 * Split from presenter-styles.ts so the controller stays under the size cap.
 */
import {
  CHAT_ATTR,
  COMPACT_CHAT_ATTR,
  CHAT_PLACEMENT_ATTR,
  DOCK_ALIGN_ATTR,
  DOCK_ATTR,
  LOG_TIMESTAMPS_ATTR,
  MIN_ATTR,
  REDUCE_MOTION_ATTR,
} from './presenter-config.js';
import { HUD_DROP_SHADOW, HUD_SURFACE_FILL } from './presenter-hud-chrome.js';

const OVERLAY = 'data-reticle-overlay';
const HUD = 'data-reticle-hud';
const CHAT_PANEL = 'data-reticle-chat-panel';
const STATE = 'data-reticle-state';
const TONE = 'data-reticle-tone';

export const SHELL_CSS = `
[${DOCK_ATTR}]{
  --reticle-surface:rgba(255,255,255,.06);
  --reticle-accent:#0088ff;--reticle-accent-soft:rgba(0,136,255,.18);
  --reticle-bg:#050506;--reticle-bg2:#0c0c10;
  --reticle-fg:#fff;--reticle-muted:rgba(255,255,255,.85);--reticle-faint:rgba(255,255,255,.5);
  --reticle-line:rgba(255,255,255,.12);--reticle-line2:rgba(255,255,255,.08);
  --reticle-read:#d4d4d4;--reticle-ok:#fafafa;--reticle-bad:#f5f5f5;
  --reticle-font:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --reticle-shell-ease:cubic-bezier(.22,1,.36,1);
  --reticle-shell-fast:.22s var(--reticle-shell-ease);
  --reticle-mark-accent:var(--reticle-accent);
  position:fixed;right:20px;bottom:20px;left:auto;
  z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  overflow:visible;max-width:calc(100vw - 24px);font-family:var(--reticle-font);-webkit-font-smoothing:antialiased;
  /**
   * ONE width for the dock and the chat above it. They were 420px and 320px, so the toolbar
   * overhung the panel it belongs to and the pair read as two unrelated widgets.
   */
  --reticle-dock-w:380px;
  /* The log is the reason the panel exists, so it gets the height rather than the chrome. */
  --reticle-chat-h:560px;
  opacity:0;transform:translate3d(0,8px,0);transition:opacity var(--reticle-shell-fast),transform var(--reticle-shell-fast);}
[${DOCK_ATTR}][data-dragged="1"]{left:var(--reticle-hud-x);top:var(--reticle-hud-y);bottom:auto;right:auto;transform:none;}
[${DOCK_ATTR}][data-dragged="1"][data-on="1"]{transform:none;}
[${DOCK_ATTR}][data-on="1"]{opacity:1;transform:translate3d(0,0,0);pointer-events:none;}
[${DOCK_ATTR}][data-on="0"]{opacity:0;pointer-events:none;}
[${CHAT_PANEL}]{
  display:none;position:absolute;right:0;left:auto;bottom:calc(100% + 8px);top:auto;z-index:5;
  box-sizing:border-box;width:var(--reticle-dock-w);max-width:min(var(--reticle-dock-w),calc(100vw - 16px));
  max-height:min(var(--reticle-chat-max-h,var(--reticle-chat-h)),calc(100vh - 120px));
  flex-direction:column;overflow:hidden;text-align:left;
  color:var(--reticle-fg);font-size:13px;line-height:1.5;
  border-radius:16px;
  box-shadow:${HUD_DROP_SHADOW};
  contain:layout style paint;
  transform:translateZ(0);
  pointer-events:none;}
[${DOCK_ATTR}][${CHAT_PLACEMENT_ATTR}="below"] [${CHAT_PANEL}]{
  bottom:auto;top:calc(100% + 8px);}
[${DOCK_ATTR}][${DOCK_ALIGN_ATTR}="start"] [${CHAT_PANEL}]{
  right:auto;left:0;}
[${OVERLAY}][${CHAT_ATTR}="1"] [${CHAT_PANEL}]{
  display:flex;pointer-events:auto;}
/* Minimise the chat without collapsing the whole HUD — sits over the panel's top-right corner. */
[${DOCK_ATTR}] .reticle-chat-min{
  position:absolute;top:6px;right:6px;z-index:4;
  width:26px;height:26px;padding:0;border:none;border-radius:50%;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  background:transparent;color:rgba(255,255,255,.6);line-height:0;}
[${DOCK_ATTR}] .reticle-chat-min:hover{background:rgba(255,255,255,.07);color:var(--reticle-fg);}
[${DOCK_ATTR}] .reticle-chat-min svg{display:block;fill:none;stroke:currentColor;stroke-width:1.5;
  stroke-linecap:round;stroke-linejoin:round;}
[${OVERLAY}][${COMPACT_CHAT_ATTR}="1"] [${CHAT_PANEL}]{width:min(var(--reticle-dock-w),320px);}
[${OVERLAY}][${LOG_TIMESTAMPS_ATTR}="0"] [data-reticle-log-ts]{display:none;}
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] [${HUD}],
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] [${CHAT_PANEL}],
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] [data-reticle-settings-panel]{
  transition-duration:.01ms !important;}
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] .reticle-fab-pulse,
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] .reticle-act-dot,
[${OVERLAY}][${REDUCE_MOTION_ATTR}="1"] [data-bump="1"]{animation:none !important;}
[${HUD}]{
  position:relative;box-sizing:border-box;pointer-events:auto;flex:none;
  width:44px;height:44px;min-height:44px;max-height:44px;overflow:visible;
  background:${HUD_SURFACE_FILL};
  color:#fff;border:none;border-radius:22px;
  box-shadow:0 2px 12px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(255,255,255,.1);
  contain:layout style;
  transition:width .26s var(--reticle-shell-ease),border-radius .26s var(--reticle-shell-ease),
    transform var(--reticle-shell-fast),opacity .18s ease;
  will-change:width,border-radius,transform;}
[${OVERLAY}][${MIN_ATTR}="0"] [${HUD}]{
  box-shadow:0 4px 20px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08),0 0 0 1px rgba(255,255,255,.12);}
[${HUD}] .reticle-hud-deco{
  position:absolute;inset:0;z-index:0;border-radius:inherit;pointer-events:none;
  opacity:0;visibility:hidden;}
[${OVERLAY}][${MIN_ATTR}="0"] [${HUD}] .reticle-hud-deco{
  opacity:1;visibility:visible;}
[${HUD}][data-on="0"]{opacity:0;transform:scale(.8);pointer-events:none;}
[${HUD}][data-on="1"]{opacity:1;transform:scale(1);}
[${OVERLAY}][${MIN_ATTR}="0"] [${HUD}]{
  width:auto;height:44px;min-height:44px;max-height:44px;min-width:44px;max-width:min(calc(100vw - 24px),var(--reticle-dock-w));border-radius:24px;padding:4px 6px;}
[${HUD}] .reticle-fab{
  position:absolute;inset:0;z-index:2;display:inline-flex;align-items:center;justify-content:center;
  width:44px;height:44px;padding:0;margin:0;border:none;border-radius:22px;cursor:pointer;
  background:transparent;color:var(--reticle-fg);line-height:0;
  transition:background .15s ease,transform .1s ease;}
[${OVERLAY}][${MIN_ATTR}="1"] [${HUD}] .reticle-fab{
  cursor:grab;touch-action:none;user-select:none;}
[${OVERLAY}][${MIN_ATTR}="1"] [${HUD}] .reticle-fab.reticle-drag-handle--dragging{
  cursor:grabbing;}
[${HUD}] .reticle-fab-mark{height:22px;width:auto;pointer-events:none;}
[${HUD}] .reticle-fab:hover{background:rgba(255,255,255,.08);}
[${HUD}] .reticle-fab:active{transform:scale(.95);}
[${HUD}] .reticle-fab:focus-visible{outline:2px solid rgba(0,136,255,.75);outline-offset:2px;}
[${HUD}] .reticle-fab-pulse{
  position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;
  background:var(--reticle-accent);opacity:0;transform:scale(.6);transition:opacity .2s,transform .2s;}
[${HUD}] .reticle-fab[data-pulse="1"] .reticle-fab-pulse{opacity:1;transform:scale(1);}
[${HUD}] .reticle-fab-badge{
  position:absolute;top:-13px;right:-13px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--reticle-accent);color:#fff;font-size:10px;font-weight:600;
  display:flex;align-items:center;justify-content:center;pointer-events:none;
  box-shadow:0 1px 3px rgba(0,0,0,.15);}
[${HUD}] .reticle-fab-badge[hidden]{display:none;}
[${OVERLAY}][${MIN_ATTR}="0"] [${HUD}] .reticle-fab{
  opacity:0;pointer-events:none;visibility:hidden;}
[${HUD}] .reticle-toolbar{
  position:relative;z-index:1;display:none;align-items:center;gap:4px;height:32px;padding:0 2px;
  overflow:visible;opacity:0;transform:scale(.94);pointer-events:none;
  transition:opacity .2s var(--reticle-shell-ease),transform .18s var(--reticle-shell-ease);}
[${OVERLAY}][${MIN_ATTR}="0"] [${HUD}] .reticle-toolbar{
  display:flex;opacity:1;transform:scale(1);pointer-events:auto;}
[${HUD}] .reticle-toolbar-drag{cursor:grab;touch-action:none;user-select:none;}
[${HUD}] .reticle-toolbar-drag.reticle-drag-handle--dragging{cursor:grabbing;}
[${HUD}] .reticle-toolbar-actions{
  display:inline-flex;align-items:center;gap:2px;flex:none;
  padding:2px;border-radius:999px;background:rgba(0,0,0,.2);}
[${HUD}] .reticle-toolbar-chrome{display:inline-flex;align-items:center;gap:2px;flex:none;}
[${HUD}] .reticle-tb-sep{width:1px;height:14px;background:rgba(255,255,255,.12);margin:0 4px;flex:none;align-self:center;}
[${HUD}] .reticle-tb-wrap{position:relative;display:flex;align-items:center;justify-content:center;overflow:visible;}
[${HUD}] .reticle-tb-btn{
  flex:none;display:inline-flex;align-items:center;justify-content:center;
  width:32px;height:32px;padding:0;border:none;border-radius:50%;cursor:pointer;
  background:transparent;color:rgba(255,255,255,.85);line-height:0;
  transition:background-color .15s ease,color .15s ease,transform .1s ease,opacity .2s ease;}
[${HUD}] .reticle-tb-btn:hover{background:rgba(255,255,255,.12);color:#fff;}
[${HUD}] .reticle-tb-btn:active{transform:scale(.92);}
[${HUD}] .reticle-tb-btn:focus-visible{outline:2px solid rgba(0,136,255,.65);outline-offset:1px;}
[${HUD}] .reticle-tb-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
[${HUD}] .reticle-tb-btn[data-active="1"]{color:var(--reticle-accent);
  background:color-mix(in srgb, var(--reticle-accent) 25%, transparent);}
[${HUD}] .reticle-tb-btn--toggle[data-active="1"]{
  color:var(--reticle-accent);background:transparent;}
[${HUD}] .reticle-tb-btn--toggle[data-active="1"]:hover{background:rgba(255,255,255,.06);color:var(--reticle-accent);}
[${HUD}] .reticle-hi-toggle{
  position:relative;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;line-height:0;flex:none;}
[${HUD}] .reticle-hi-toggle .reticle-hi-icon{
  position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;
  transition:opacity .14s ease;}
[${HUD}] .reticle-hi-toggle .reticle-hi-icon--solid{opacity:0;}
[${HUD}] .reticle-hi-toggle .reticle-hi-icon--solid svg{
  transform:scale(1.12);transform-origin:center;}
/*
 * Active toggles keep the OUTLINE icon. They used to swap to the solid heroicon, which is a filled
 * glyph next to 1.5px strokes everywhere else, so the pressed button read as a heavier typeface
 * rather than as a state. The state is already carried by accent colour and a background above,
 * which is enough and does not change the icon's weight.
 */
[${HUD}] .reticle-tb-btn--toggle[data-active="1"] .reticle-hi-icon--outline{opacity:1;}
[${HUD}] .reticle-tb-btn--toggle .reticle-hi-icon--solid{opacity:0;}
[${HUD}] .reticle-tb-btn--toggle .reticle-hi-icon--solid svg{color:inherit;}
[${HUD}] .reticle-tb-btn--primary[data-active="1"]{
  color:#fff;background:rgba(255,255,255,.14);}
[${HUD}] .reticle-tb-btn[data-danger]:hover:not(:disabled){color:#ff383c;
  background:color-mix(in srgb, #ff383c 25%, transparent);}
[${HUD}] .reticle-tb-btn--export{display:none;}
[${OVERLAY}][${STATE}="ended"] [${HUD}] .reticle-tb-btn--export{display:inline-flex;}
[${HUD}] .reticle-tb-tip{
  position:absolute;bottom:calc(100% + 14px);left:50%;transform:translateX(-50%) scale(.95);
  padding:6px 10px;background:#1a1a1a;color:rgba(255,255,255,.9);font-size:12px;font-weight:500;
  border-radius:8px;white-space:nowrap;opacity:0;visibility:hidden;pointer-events:none;z-index:3;
  box-shadow:0 2px 8px rgba(0,0,0,.3);transition:opacity .135s ease,transform .135s ease,visibility .135s;}
[${HUD}] .reticle-tb-tip::after{
  content:"";position:absolute;top:calc(100% - 4px);left:50%;transform:translateX(-50%) rotate(45deg);
  width:8px;height:8px;background:#1a1a1a;border-radius:0 0 2px 0;}
[${HUD}] .reticle-tb-wrap:hover .reticle-tb-tip{
  opacity:1;visibility:visible;transform:translateX(-50%) scale(1);transition-delay:.3s;}
[${HUD}] .reticle-tb-wrap:has(.reticle-tb-btn:disabled):hover .reticle-tb-tip{opacity:0;visibility:hidden;}
[${HUD}] .reticle-tb-wrap--pause:hover .reticle-pause-badge{opacity:0;}
[${HUD}] .reticle-tb-kbd{margin-left:4px;opacity:.5;}
[${HUD}] .reticle-pause-badge{
  display:none;position:absolute;bottom:calc(100% + 5px);left:50%;transform:translateX(-50%);
  align-items:center;flex:none;font-weight:600;letter-spacing:.08em;font-size:7px;
  color:var(--reticle-fg);border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.55);
  padding:2px 6px;border-radius:999px;white-space:nowrap;pointer-events:none;z-index:2;
  transition:opacity .12s ease;}
[${OVERLAY}][${STATE}="paused"] [data-reticle-badge]{display:inline-flex;}
[${DOCK_ATTR}] .reticle-chip{display:none;flex:none;align-items:center;gap:4px;font-size:8px;font-weight:600;letter-spacing:.06em;
  padding:3px 7px;border-radius:999px;text-transform:uppercase;background:rgba(255,255,255,.06);}
[${DOCK_ATTR}] .reticle-chip[data-mode="reading"],
[${DOCK_ATTR}] .reticle-chip[data-mode="acting"]{display:inline-flex;color:var(--reticle-fg);}
[${DOCK_ATTR}] .reticle-tally[hidden]{display:none;}
[${DOCK_ATTR}] .reticle-tally{align-self:center;flex:none;}
[${DOCK_ATTR}] .reticle-pill-group{
  display:inline-flex;align-items:stretch;flex:none;border-radius:999px;overflow:hidden;
  background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);}
[${DOCK_ATTR}] .reticle-pill-segment{
  display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;
  font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1;color:var(--reticle-fg);}
[${DOCK_ATTR}] .reticle-pill-segment[data-z="1"]{opacity:.4;}
[${DOCK_ATTR}] .reticle-t-pass.reticle-pill-segment{background:rgba(34,197,94,.14);color:#bbf7d0;}
[${DOCK_ATTR}] .reticle-t-fail.reticle-pill-segment{background:rgba(239,68,68,.14);color:#fecaca;}
[${DOCK_ATTR}] .reticle-pill-sep{width:1px;align-self:stretch;background:rgba(255,255,255,.12);flex:none;margin:0;}
[${DOCK_ATTR}] .reticle-pill-count{min-width:1ch;}
[${DOCK_ATTR}] .reticle-tally .reticle-hi-icon{opacity:.92;}
@keyframes reticle-tally-pop{0%{transform:scale(1)}38%{transform:scale(1.3)}100%{transform:scale(1)}}
[${DOCK_ATTR}] .reticle-tally [data-bump="1"]{display:inline-flex;animation:reticle-tally-pop .36s cubic-bezier(.16,1,.3,1);}
[${HUD}] .reticle-hi-icon{display:inline-flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0;color:inherit;}
[${HUD}] .reticle-hi-icon svg{display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;}
[${HUD}] .reticle-live{display:none;}
[${CHAT_PANEL}] .reticle-act-strip{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;
  border-bottom:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.22);}
[${CHAT_PANEL}] .reticle-act-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--reticle-faint);
  box-shadow:0 0 0 2px rgba(255,255,255,.04);transition:background .2s,box-shadow .2s;}
[${CHAT_PANEL}] .reticle-act-strip[data-liveness="active"] .reticle-act-dot{background:#fafafa;
  box-shadow:0 0 0 2px rgba(255,255,255,.12),0 0 8px rgba(255,255,255,.28);}
[${CHAT_PANEL}] .reticle-act-strip[data-liveness="idle"] .reticle-act-dot{animation:reticle-idle-pulse 2.4s ease-in-out infinite;}
@keyframes reticle-idle-pulse{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}
[${CHAT_PANEL}] .reticle-act{display:block;flex:1;min-width:0;color:var(--reticle-muted);font-size:11px;
  font-variant-numeric:tabular-nums;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
[${CHAT_PANEL}] .reticle-act-strip[data-liveness="active"] .reticle-act{color:var(--reticle-fg);}
[${HUD}] .reticle-pass{color:var(--reticle-ok);}[${HUD}] .reticle-fail{color:var(--reticle-bad);}
[${OVERLAY}][${STATE}="paused"] [${HUD}]{--reticle-accent:#e5e5e5;--reticle-accent-soft:rgba(255,255,255,.1);}
[${OVERLAY}][${STATE}="ended"] [${HUD}]{--reticle-accent:#d4d4d4;--reticle-accent-soft:rgba(255,255,255,.06);}
[${OVERLAY}][${TONE}="waiting"] [${HUD}]{--reticle-accent:#e5e5e5;--reticle-accent-soft:rgba(255,255,255,.08);}
[${OVERLAY}][${TONE}="ask"] [${HUD}],
[${OVERLAY}][${TONE}="warn"] [${HUD}]{--reticle-accent:#d4d4d4;--reticle-accent-soft:rgba(255,255,255,.06);}
@media (max-width:480px){
  [${CHAT_PANEL}]{width:min(100vw - 24px,320px);max-height:min(360px,calc(100vh - 100px));}
  [${OVERLAY}][${MIN_ATTR}="0"] [${HUD}]{max-width:calc(100vw - 24px);}
}` as string;
