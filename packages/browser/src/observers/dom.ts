import { EventType, TruncationChannel } from '@reticlehq/core';
import { getAccessibleName, getRole, isVisible } from '../dom/a11y.js';
import { refs } from '../dom/refs.js';
import { isReticleOverlay } from '../dom/dom-ignore.js';
import type { Emit, Teardown } from './types.js';

const WATCHED_ATTRS = [
  'class',
  'hidden',
  'disabled',
  'open',
  'aria-hidden',
  'aria-expanded',
  'aria-selected',
  'aria-checked',
  'data-state',
  // Widened (W3): visual + resource + form-value attributes. Values are capped (they can be long).
  'style',
  'src',
  'href',
  'value',
];

/** Attribute/text values are capped per event — style/src can be huge and would bloat the ledger. */
const MAX_ATTR_VALUE_LEN = 120;

function capValue(value: string | null): string | undefined {
  if (value === null) return undefined;
  return value.length > MAX_ATTR_VALUE_LEN ? `${value.slice(0, MAX_ATTR_VALUE_LEN)}…` : value;
}

const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);
const LIVE_ROLES = new Set(['alert', 'status']);

/** Max meaningful added/removed nodes reported per mutation batch (backpressure). */
const MAX_PER_BATCH = 40;

function isMeaningful(role: string, name: string): boolean {
  return role !== 'generic' || name.length > 0;
}

/** Observe DOM mutations and emit semantic (not raw) events. */
export function installDom(emit: Emit): Teardown {
  const observer = new MutationObserver((records) => {
    let added = 0;
    let removed = 0;
    let changed = 0;
    // Count element nodes dropped purely because a per-batch cap was already reached. The cap is on
    // MEANINGFUL events, so it is only hit after a real flood — the count is a raw over-estimate
    // (it can include not-yet-inspected noise) but `dropped > 0` honestly means "this batch was capped".
    let dropped = 0;
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target instanceof Element && record.attributeName !== null && !isReticleOverlay(target)) {
          if (changed >= MAX_PER_BATCH) {
            dropped += 1;
            continue;
          }
          changed += 1;
          // Old value (attributeOldValue) + capped new value — a diff, not just a reading.
          const value = capValue(target.getAttribute(record.attributeName));
          const old = capValue(record.oldValue);
          emit(
            EventType.DOM_ATTR,
            {
              attr: record.attributeName,
              ...(value === undefined ? {} : { value }),
              ...(old === undefined ? {} : { old }),
            },
            refs.refFor(target),
          );
        }
        continue;
      }
      if (record.type === 'characterData') {
        // In-place text change inside an existing subtree (wizard steps, inline edits) —
        // childList-only would miss this.
        const parent = record.target.parentElement;
        if (parent !== null && !isReticleOverlay(parent)) {
          if (changed >= MAX_PER_BATCH) {
            dropped += 1;
            continue;
          }
          changed += 1;
          const text = (record.target.textContent ?? '').trim().slice(0, 80);
          const old = capValue(record.oldValue?.trim() ?? null);
          emit(
            EventType.DOM_TEXT,
            { text, ...(old === undefined ? {} : { old }) },
            refs.refFor(parent),
          );
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (added >= MAX_PER_BATCH) {
          dropped += 1;
          continue;
        }
        if (isReticleOverlay(node)) continue;
        const role = getRole(node);
        const name = getAccessibleName(node);
        if (!isMeaningful(role, name)) continue;
        added += 1;
        const ref = refs.refFor(node);
        emit(EventType.DOM_ADDED, { role, name }, ref);
        if (
          DIALOG_ROLES.has(role) ||
          LIVE_ROLES.has(role) ||
          node.getAttribute('aria-modal') === 'true'
        ) {
          if (isVisible(node)) emit(EventType.VISIBLE_SHOWN, { role, name }, ref);
        }
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (removed >= MAX_PER_BATCH) {
          dropped += 1;
          continue;
        }
        if (isReticleOverlay(node)) continue;
        const role = getRole(node);
        const name = getAccessibleName(node);
        if (!isMeaningful(role, name)) continue;
        removed += 1;
        emit(EventType.DOM_REMOVED, { role, name });
      }
    }
    // Never silent: a capped batch tells the ledger its DOM counts understate reality.
    if (dropped > 0) emit(EventType.TRUNCATED, { channel: TruncationChannel.DOM, dropped });
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRS,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
  });

  return () => {
    observer.disconnect();
  };
}
