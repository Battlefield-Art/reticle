import {
  SETTINGS_PANEL_ATTR,
  SETTINGS_ATTR,
  ACCENT_ATTR,
  DOCK_ATTR,
  DOCK_ALIGN_ATTR,
  SETTINGS_PLACEMENT_ATTR,
} from './presenter-config.js';
import { HUD_DROP_SHADOW, HUD_SURFACE_CLASS, HUD_SURFACE_PAINT } from './presenter-hud-chrome.js';

/** Compact settings card - dock-anchored above the HUD pill. */
export const SETTINGS_CSS = `
[${'data-reticle-overlay'}][${SETTINGS_ATTR}="1"] [${'data-reticle-chat-panel'}]{
  display:none !important;visibility:hidden !important;pointer-events:none !important;}
[${SETTINGS_PANEL_ATTR}]{
  position:absolute;right:0;left:auto;top:auto;bottom:calc(100% + 12px);z-index:30;
  box-sizing:border-box;display:flex;flex-direction:column;width:272px;min-height:0;
  max-width:min(272px,calc(100vw - 16px));
  max-height:min(var(--reticle-settings-max-h,78vh),calc(100vh - 96px));
  padding:0;border:none;border-radius:16px;overflow:hidden;
  box-shadow:${HUD_DROP_SHADOW};
  color:var(--reticle-fg);font-size:13px;line-height:1.35;
  opacity:0;pointer-events:none;visibility:hidden;touch-action:manipulation;
  transform:translate3d(0,6px,0) scale(.98);
  transition:opacity .14s ease,transform .18s cubic-bezier(.22,1,.36,1),visibility .14s;
  contain:none;isolation:isolate;${HUD_SURFACE_PAINT}}
[${DOCK_ATTR}][${SETTINGS_PLACEMENT_ATTR}="below"] [${SETTINGS_PANEL_ATTR}]{
  bottom:auto;top:calc(100% + 12px);}
[${DOCK_ATTR}][${DOCK_ALIGN_ATTR}="start"] [${SETTINGS_PANEL_ATTR}]{
  right:auto;left:0;}
[${DOCK_ATTR}][${SETTINGS_PLACEMENT_ATTR}="below"] [${SETTINGS_PANEL_ATTR}].${HUD_SURFACE_CLASS}::after{
  top:auto;bottom:100%;margin-top:0;margin-bottom:-4px;box-shadow:-1px -1px 0 0 rgba(255,255,255,.08);}
[${DOCK_ATTR}][${DOCK_ALIGN_ATTR}="start"] [${SETTINGS_PANEL_ATTR}].${HUD_SURFACE_CLASS}::after{
  right:auto;left:14px;}
[${'data-reticle-overlay'}][${SETTINGS_ATTR}="1"] [${SETTINGS_PANEL_ATTR}]{
  opacity:1;pointer-events:auto;visibility:visible;transform:translate3d(0,0,0) scale(1);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-inner{
  position:relative;z-index:2;display:grid;grid-template-rows:auto minmax(0,1fr) auto;
  flex:1 1 auto;min-height:0;max-height:100%;overflow:hidden;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-head{
  display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:8px;
  padding:12px 14px 8px;border-bottom:1px solid rgba(255,255,255,.06);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-title{
  font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.45);}
[${SETTINGS_PANEL_ATTR}].${HUD_SURFACE_CLASS}::after{
  content:"";position:absolute;top:100%;right:14px;width:8px;height:8px;margin-top:-4px;
  background:#000;transform:rotate(45deg);box-shadow:1px 1px 0 0 rgba(255,255,255,.08);z-index:0;pointer-events:none;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-close{
  position:relative;top:auto;right:auto;z-index:1;
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;padding:0;border:none;border-radius:999px;cursor:pointer;
  background:rgba(255,255,255,.06);color:var(--reticle-muted);line-height:0;
  transition:background .15s,color .15s,transform .1s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-close:hover{background:rgba(255,255,255,.12);color:var(--reticle-fg);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-close:active{transform:scale(.94);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-close:focus-visible{outline:2px solid rgba(59,130,246,.65);outline-offset:1px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-body{
  min-height:0;padding:6px 0 4px;overflow-x:hidden;overflow-y:auto;
  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
  scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.14) transparent;
  background:linear-gradient(180deg,#0a0a0e 0%,#000 100%);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-body::-webkit-scrollbar{width:8px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-body::-webkit-scrollbar-thumb{
  background:rgba(255,255,255,.14);border-radius:8px;border:2px solid transparent;background-clip:content-box;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-row{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:8px 14px;min-height:30px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-label{
  display:inline-flex;align-items:center;gap:6px;color:rgba(255,255,255,.62);font-size:13px;font-weight:500;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-help{
  display:inline-flex;align-items:center;justify-content:center;
  width:14px;height:14px;border:none;border-radius:999px;padding:0;cursor:help;
  background:transparent;color:rgba(255,255,255,.35);line-height:0;flex:none;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-help:hover{color:rgba(255,255,255,.75);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-help:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:1px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-cycle{
  display:inline-flex;align-items:center;gap:8px;border:none;border-radius:8px;cursor:pointer;
  background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:12px;font-weight:600;
  padding:5px 8px 5px 10px;transition:background .15s,transform .1s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-cycle:hover{background:rgba(255,255,255,.12);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-cycle:active{transform:scale(.97);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-cycle:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:1px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-dots{display:inline-flex;flex-direction:column;gap:2px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-dot{
  width:3px;height:3px;border-radius:999px;background:rgba(255,255,255,.22);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-dot[data-on="1"]{background:var(--reticle-accent);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-toggle{
  position:relative;width:28px;height:18px;border:none;border-radius:999px;cursor:pointer;padding:0;flex:none;
  background:rgba(255,255,255,.16);transition:background .15s ease,box-shadow .15s ease;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-toggle[data-on="1"]{background:var(--reticle-accent);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-toggle::after{
  content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
  background:#fafafa;box-shadow:0 1px 2px rgba(0,0,0,.35);transition:transform .15s ease;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-toggle[data-on="1"]::after{transform:translateX(10px);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-toggle:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:2px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-row[data-disabled="1"]{opacity:.45;pointer-events:none;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-section{
  padding:10px 14px 6px;color:rgba(255,255,255,.38);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-swatches{
  display:flex;gap:8px;flex-wrap:wrap;padding:0 14px 10px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-swatch{
  width:24px;height:24px;border-radius:999px;padding:0;cursor:pointer;
  border:2px solid transparent;background-clip:padding-box;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.25);transition:transform .12s,border-color .12s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-swatch:hover{transform:scale(1.06);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-swatch[data-on="1"]{
  border-color:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-swatch:focus-visible{outline:2px solid rgba(59,130,246,.65);outline-offset:2px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-checkrow{
  display:flex;align-items:center;gap:10px;padding:7px 14px;color:rgba(255,255,255,.8);font-size:13px;
  cursor:pointer;user-select:none;margin:0;transition:background .12s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-checkrow:hover{background:rgba(255,255,255,.03);}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-check{
  width:16px;height:16px;border-radius:5px;border:1px solid rgba(255,255,255,.22);
  background:rgba(255,255,255,.04);display:inline-flex;align-items:center;justify-content:center;
  color:transparent;font-size:10px;line-height:1;flex:none;transition:background .12s,border-color .12s,color .12s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-check[data-on="1"]{
  background:#fafafa;border-color:#fafafa;color:#111;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-check:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:2px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-foot{
  flex-shrink:0;margin-top:2px;border-top:1px solid rgba(255,255,255,.08);
  display:flex;flex-direction:column;gap:0;background:#000;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-reset{
  width:100%;display:flex;align-items:center;justify-content:center;gap:6px;
  border:none;background:rgba(255,255,255,.04);color:rgba(255,255,255,.78);font:inherit;font-size:12px;font-weight:600;
  padding:10px 14px;cursor:pointer;text-align:center;transition:background .12s,color .12s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-reset:hover{background:rgba(255,255,255,.08);color:#fff;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-reset:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:-2px;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-link{
  width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;
  border:none;background:transparent;color:rgba(255,255,255,.82);font:inherit;font-size:13px;
  padding:11px 14px;cursor:pointer;text-align:left;transition:background .12s,color .12s;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-link-caret{display:inline-flex;align-items:center;flex:none;opacity:.55;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-link:hover{background:rgba(255,255,255,.04);color:#fff;}
[${SETTINGS_PANEL_ATTR}] .reticle-settings-link:focus-visible{outline:2px solid rgba(59,130,246,.55);outline-offset:-2px;}
[${'data-reticle-overlay'}][${SETTINGS_ATTR}="1"] [${'data-reticle-hud'}] .reticle-tb-tip{
  opacity:0;visibility:hidden;transition-delay:0s;}
[${'data-reticle-dock'}][${ACCENT_ATTR}="purple"]{--reticle-accent:#a855f7;--reticle-accent-soft:rgba(168,85,247,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="blue"]{--reticle-accent:#3b82f6;--reticle-accent-soft:rgba(59,130,246,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="cyan"]{--reticle-accent:#06b6d4;--reticle-accent-soft:rgba(6,182,212,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="green"]{--reticle-accent:#22c55e;--reticle-accent-soft:rgba(34,197,94,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="yellow"]{--reticle-accent:#eab308;--reticle-accent-soft:rgba(234,179,8,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="orange"]{--reticle-accent:#f97316;--reticle-accent-soft:rgba(249,115,22,.18);}
[${'data-reticle-dock'}][${ACCENT_ATTR}="red"]{--reticle-accent:#ef4444;--reticle-accent-soft:rgba(239,68,68,.18);}
[${'data-reticle-blocker'}]{
  position:fixed;inset:0;z-index:1;background:rgba(0,0,0,.16);pointer-events:auto;}
[${'data-reticle-overlay'}][data-reticle-block="0"] [${'data-reticle-blocker'}]{
  display:none;pointer-events:none;}
[${'data-reticle-overlay'}][data-reticle-hidden="1"] [${DOCK_ATTR}],
[${'data-reticle-overlay'}][data-reticle-hidden="1"] [${SETTINGS_PANEL_ATTR}]{display:none !important;}
` as string;
