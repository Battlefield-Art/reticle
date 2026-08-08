import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ActionWarning, ReticleCommand } from '@reticlehq/core';
import { executeAction, executeSequence } from './actions.js';
import { createCommandRegistry } from '../commands/commands.js';
import { registerAdapter, type ReticleAdapter } from '../registry/adapters.js';
import { refs } from '../dom/refs.js';

const adapters = ((
  globalThis as unknown as { __reticleAdapters?: ReticleAdapter[] }
).__reticleAdapters ??= []);

function refOf(selector: string): string {
  const el = document.querySelector(selector);
  if (el === null) throw new Error(`no element for ${selector}`);
  return refs.refFor(el);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('action effect: happy path', () => {
  it('reports dispatched/targetMatched/visible/enabled on a normal click', async () => {
    document.body.innerHTML = '<button>Save</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.effect.dispatched).toBe(true);
    expect(r.effect.targetMatched).toBe(true);
    expect(r.effect.visible).toBe(true);
    expect(r.effect.enabled).toBe(true);
  });
});

describe('action effect: enabled / visible probes', () => {
  it('enabled=false for a disabled button', async () => {
    document.body.innerHTML = '<button disabled>Save</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.effect.enabled).toBe(false);
  });

  it('visible=false for a display:none button', async () => {
    document.body.innerHTML = '<button style="display:none">Save</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.effect.visible).toBe(false);
  });
});

describe('action effect: defaultPrevented', () => {
  it('defaultPrevented=true when a handler calls preventDefault', async () => {
    document.body.innerHTML = '<a href="#">link</a>';
    const a = document.querySelector('a') as HTMLAnchorElement;
    a.addEventListener('click', (e) => {
      e.preventDefault();
    });
    const r = await executeAction(refs.refFor(a), 'click');
    expect(r.effect.defaultPrevented).toBe(true);
  });

  it('defaultPrevented=false when nothing prevents', async () => {
    document.body.innerHTML = '<button>Save</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.effect.defaultPrevented).toBe(false);
  });
});

describe('action effect: focusMoved', () => {
  it('reports null->eN when focusing an input', async () => {
    document.body.innerHTML = '<input />';
    const r = await executeAction(refOf('input'), 'focus');
    expect(r.effect.focusMoved).toMatch(/^null->e\d+$/);
  });

  it('reports ->null on blur', async () => {
    document.body.innerHTML = '<input />';
    const input = document.querySelector('input') as HTMLInputElement;
    input.focus();
    const r = await executeAction(refs.refFor(input), 'blur');
    expect(r.effect.focusMoved).toMatch(/->null$/);
  });

  it('focusMoved=null when clicking a non-focusing div', async () => {
    document.body.innerHTML = '<div>plain</div>';
    const r = await executeAction(refOf('div'), 'click');
    expect(r.effect.focusMoved).toBeNull();
  });
});

describe('action effect: valueChanged', () => {
  it('valueChanged=true on fill', async () => {
    document.body.innerHTML = '<input />';
    const r = await executeAction(refOf('input'), 'fill', { value: 'hi' });
    expect(r.effect.valueChanged).toBe(true);
    expect(r.effect.defaultPrevented).toBe(false);
  });

  it('valueChanged=false when filling the same value', async () => {
    document.body.innerHTML = '<input value="hi" />';
    const input = document.querySelector('input') as HTMLInputElement;
    input.value = 'hi';
    const r = await executeAction(refs.refFor(input), 'fill', { value: 'hi' });
    expect(r.effect.valueChanged).toBe(false);
  });

  it('valueChanged=false for a non-fill action on an input', async () => {
    document.body.innerHTML = '<input value="hi" />';
    const r = await executeAction(refOf('input'), 'click');
    expect(r.effect.valueChanged).toBe(false);
  });

  it('clear sets valueChanged=true and empties the value', async () => {
    document.body.innerHTML = '<input value="hi" />';
    const input = document.querySelector('input') as HTMLInputElement;
    input.value = 'hi';
    const r = await executeAction(refs.refFor(input), 'clear');
    expect(r.effect.valueChanged).toBe(true);
    expect(input.value).toBe('');
  });

  it('select to a REAL option reports valueChanged=true', async () => {
    document.body.innerHTML =
      '<select><option value="a">A</option><option value="b">B</option></select>';
    const r = await executeAction(refOf('select'), 'select', { value: 'b' });
    expect(r.effect.valueChanged).toBe(true);
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('b');
  });

  it('select to a NON-EXISTENT option does not take the requested value (detectable no-op)', async () => {
    // The false green: the select silently rejects the invalid value, but the action used to report
    // plain success with valueChanged hardcoded false. Now SELECT is fill-like, so the value delta is
    // reported AND the resulting value proves the requested option never took.
    document.body.innerHTML = '<select><option value="a">A</option></select>';
    const sel = document.querySelector('select') as HTMLSelectElement;
    const r = await executeAction(refs.refFor(sel), 'select', { value: 'does-not-exist' });
    expect(sel.value).not.toBe('does-not-exist'); // the invalid option was rejected
    expect(r.effect.valueChanged).toBe(true); // a -> '' — a real, agent-visible change, not a fake false
  });

  it('clear on a non-field element THROWS instead of reporting silent success', async () => {
    document.body.innerHTML = '<div>not a field</div>';
    await expect(executeAction(refOf('div'), 'clear')).rejects.toThrow(/cannot clear/);
  });
});

describe('action effect: domMutatedWithin', () => {
  it('counts mutations triggered by the action handler', async () => {
    document.body.innerHTML = '<button>add</button>';
    const button = document.querySelector('button') as HTMLButtonElement;
    button.addEventListener('click', () => {
      const span = document.createElement('span');
      span.textContent = 'new';
      document.body.appendChild(span);
    });
    const r = await executeAction(refs.refFor(button), 'click');
    expect(r.effect.domMutatedWithin).toBeGreaterThanOrEqual(1);
  });

  it('is 0 when nothing changes the DOM', async () => {
    document.body.innerHTML = '<button>noop</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.effect.domMutatedWithin).toBe(0);
  });
});

describe('action effect: unresolvable ref', () => {
  it('rejects when the ref no longer resolves (tool did not dispatch)', async () => {
    document.body.innerHTML = '<button>gone</button>';
    const ref = refOf('button');
    document.body.innerHTML = '';
    await expect(executeAction(ref, 'click')).rejects.toThrow();
  });
});

describe('executeSequence effects', () => {
  it('returns one effect per step, all dispatched', async () => {
    document.body.innerHTML = '<input /><button>go</button>';
    const inputRef = refOf('input');
    const buttonRef = refOf('button');
    const r = await executeSequence([
      { ref: inputRef, action: 'fill', args: { value: 'x' } },
      { ref: buttonRef, action: 'click' },
    ]);
    expect(r.effects).toHaveLength(2);
    expect(r.effects.every((e) => e.dispatched)).toBe(true);
  });
});

describe('command registry passthrough', () => {
  it('ACT handler returns an effect block', async () => {
    document.body.innerHTML = '<button>Save</button>';
    const ref = refOf('button');
    const reg = createCommandRegistry();
    const handler = reg.get(ReticleCommand.ACT);
    if (handler === undefined) throw new Error('no act handler');
    const out = (await handler({ ref, action: 'click' })) as { effect?: unknown };
    expect(out.effect).toBeDefined();
  });
});

describe('action result: hover enter/leave warning', () => {
  beforeEach(() => {
    adapters.length = 0;
  });
  afterEach(() => {
    adapters.length = 0;
  });

  it('warns when the adapter reports the hover target has enter/leave handlers', async () => {
    registerAdapter({
      name: 'mock-hover',
      identify: () => null,
      hasHoverHandlers: () => true,
    });
    document.body.innerHTML = '<button>x</button>';
    const r = await executeAction(refOf('button'), 'hover');
    expect(r.warning).toBe(ActionWarning.HOVER_NATIVE_ENTER_LEAVE);
  });

  it('no warning when the adapter reports no hover handlers', async () => {
    registerAdapter({
      name: 'mock-hover',
      identify: () => null,
      hasHoverHandlers: () => false,
    });
    document.body.innerHTML = '<button>x</button>';
    const r = await executeAction(refOf('button'), 'hover');
    expect(r.warning).toBeUndefined();
  });

  it('no warning for a non-hover action even when handlers are present', async () => {
    registerAdapter({
      name: 'mock-hover',
      identify: () => null,
      hasHoverHandlers: () => true,
    });
    document.body.innerHTML = '<button>x</button>';
    const r = await executeAction(refOf('button'), 'click');
    expect(r.warning).toBeUndefined();
  });

  it('no warning (no-op-safe) when no adapter is installed', async () => {
    document.body.innerHTML = '<button>x</button>';
    const r = await executeAction(refOf('button'), 'hover');
    expect(r.warning).toBeUndefined();
  });

  it('improved hover dispatches a bubbling mouseover with relatedTarget', async () => {
    document.body.innerHTML = '<button>x</button>';
    const button = document.querySelector('button') as HTMLButtonElement;
    let seen = false;
    let related: EventTarget | null = null;
    document.body.addEventListener('mouseover', (e) => {
      seen = true;
      related = e.relatedTarget;
    });
    await executeAction(refs.refFor(button), 'hover');
    expect(seen).toBe(true);
    expect(related).not.toBeNull();
  });
});

describe('action result: testid normalization', () => {
  it('includes data-testid of the resolved element', async () => {
    document.body.innerHTML = '<button data-testid="pay-btn">Pay</button>';
    const r = await executeAction(refOf('button'), 'click', { confirmDangerous: true });
    expect(r.testid).toBe('pay-btn');
  });

  it('omits testid when the element has none', async () => {
    document.body.innerHTML = '<button>Pay</button>';
    const r = await executeAction(refOf('button'), 'click', { confirmDangerous: true });
    expect(r.testid).toBeUndefined();
  });

  it('executeSequence returns per-step testids where present', async () => {
    document.body.innerHTML = '<button data-testid="a">A</button><button>B</button>';
    const out = await executeSequence([
      { ref: refOf('[data-testid="a"]'), action: 'click' },
      { ref: refOf('button:not([data-testid])'), action: 'click' },
    ]);
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]?.testid).toBe('a');
    expect(out.steps[1]?.testid).toBeUndefined();
  });

  /**
   * A sequence step reported ONLY its testid, while a single act reports role+name and
   * component/source too. Every app without testids therefore compiled every sub-step to a volatile
   * ref, the flow saved the degraded `unresolved` sentinel, and replay drifted — measured on 7 of 7
   * apps in a field sweep. The narrowing is the whole bug: the anchors exist, they were dropped on
   * the way out.
   */
  it('executeSequence carries the same anchors a single act does', async () => {
    document.body.innerHTML = '<button>Pay now</button>';
    const out = await executeSequence([
      { ref: refOf('button'), action: 'click', args: { confirmDangerous: true } },
    ]);
    expect(out.steps[0]?.role).toBe('button');
    expect(out.steps[0]?.name).toBe('Pay now');
  });
});
