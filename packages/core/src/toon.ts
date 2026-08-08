/**
 * TOON — Token-Optimized Object Notation.
 *
 * A compact, deterministic, line-oriented text format for Reticle snapshots and query results.
 * This is a ONE-WAY, encode-only projection of the internal JSON representation (there is no decoder
 * back to JSON — the agent reads TOON, it is never parsed back). Not a binary format — Claude must be
 * able to generate and read it reliably from its training data alone.
 *
 * Grammar (one element per line):
 * type ref "name" [states] key=value...
 *
 * Element types (abbreviated roles):
 * btn button inp textbox/input sel combobox/listbox chk checkbox
 * rad radio lnk link img img dlg dialog/alertdialog
 * nav navigation lst list/listbox tab tab/tabpanel hdr heading
 * frm form mn menu/menubar fld group/fieldset el (any other role)
 *
 * State flags (inside []):
 * vis visible hid hidden en enabled dis disabled
 * chk checked uch unchecked exp expanded col collapsed focus
 *
 * Attributes (key=value, space-separated):
 * val="..." current value of the element
 * count=N child count (for containers, replaces expanding children)
 * ph="..." placeholder text
 */

/** Encode an ElementDescriptor to a TOON line. */
export interface ToonElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  states?: string[];
  visible?: boolean;
  text?: string;
  children?: ToonElement[];
  childCount?: number;
}

const ROLE_MAP: Record<string, string> = {
  button: 'btn',
  textbox: 'inp',
  search: 'inp',
  checkbox: 'chk',
  radio: 'rad',
  link: 'lnk',
  img: 'img',
  dialog: 'dlg',
  alertdialog: 'dlg',
  navigation: 'nav',
  list: 'lst',
  listbox: 'lst',
  listitem: 'li',
  combobox: 'sel',
  option: 'opt',
  tab: 'tab',
  tabpanel: 'tab',
  heading: 'hdr',
  form: 'frm',
  menu: 'mn',
  menubar: 'mn',
  menuitem: 'mi',
  group: 'fld',
  fieldset: 'fld',
  table: 'tbl',
  row: 'row',
  cell: 'cel',
  main: 'main',
  banner: 'hdr',
  grid: 'grd',
  gridcell: 'cel',
  tree: 'tree',
  treeitem: 'titem',
  switch: 'sw',
  slider: 'sldr',
  spinbutton: 'spin',
};

function abbreviateRole(role: string): string {
  return ROLE_MAP[role] ?? 'el';
}

function encodeStates(states: string[], visible?: boolean): string {
  const flags: string[] = [];
  if (true === visible) flags.push('vis');
  else if (false === visible) flags.push('hid');
  for (const s of states) {
    switch (s) {
      case 'visible':
        break; // handled above
      case 'hidden':
        break; // handled above
      case 'enabled':
        flags.push('en');
        break;
      case 'disabled':
        flags.push('dis');
        break;
      case 'checked':
        flags.push('chk');
        break;
      case 'unchecked':
        flags.push('uch');
        break;
      case 'expanded':
        flags.push('exp');
        break;
      case 'collapsed':
        flags.push('col');
        break;
      case 'focused':
        flags.push('focus');
        break;
      default:
        flags.push(s);
    }
  }
  return flags.length > 0 ? `[${flags.join(',')}]` : '';
}

/** Coerce a wire field to a string. resultToToon receives UNVALIDATED wire data cast to ToonElement,
 * so a missing/numeric `name` must not make `.replace` throw and lose the whole encode. */
function toText(v: unknown): string {
  if ('string' === typeof v) return v;
  if ('number' === typeof v || 'boolean' === typeof v || 'bigint' === typeof v) return String(v);
  return ''; // undefined / null / object / symbol have no representable text on a wire field
}

function encodeName(name: unknown): string {
  return `"${toText(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function encodeValue(val: unknown): string {
  return `"${toText(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function encodeLine(el: ToonElement, depth: number): string {
  const indent = '  '.repeat(depth);
  const type = abbreviateRole(el.role);
  const states = encodeStates(Array.isArray(el.states) ? el.states : [], el.visible);
  const ref = toText(el.ref) || '?';
  const parts: string[] = [indent + type, ref, encodeName(el.name), ...(states ? [states] : [])];
  if ('string' === typeof el.value && el.value.length > 0)
    parts.push(`val=${encodeValue(el.value)}`);
  if (el.childCount !== undefined) parts.push(`count=${String(el.childCount)}`);
  return parts.join(' ');
}

function encodeTree(elements: ToonElement[], depth = 0): string {
  const lines: string[] = [];
  for (const el of elements) {
    // A single malformed element must not lose the rest of the tree — fall back to a placeholder line.
    try {
      lines.push(encodeLine(el, depth));
      if (Array.isArray(el.children) && el.children.length > 0) {
        lines.push(encodeTree(el.children, depth + 1));
      }
    } catch {
      lines.push(`${'  '.repeat(depth)}el ? "[unencodable]"`);
    }
  }
  return lines.join('\n');
}

/** Encode an array of ElementDescriptor-shaped objects to TOON text. */
export function toToon(elements: ToonElement[]): string {
  if (0 === elements.length) return '# TOON v1 — empty';
  return `# TOON v1\n${encodeTree(elements)}`;
}

/** Encode a single reticle_snapshot or reticle_query result object to TOON. */
export function resultToToon(result: Record<string, unknown>): string {
  const elements = result['elements'];
  if (!Array.isArray(elements)) return JSON.stringify(result);
  return toToon(elements as ToonElement[]);
}

/** Whether a tool result object should be encoded as TOON (has an elements array). */
export function isToonable(result: unknown): boolean {
  return (
    'object' === typeof result &&
    result !== null &&
    !Array.isArray(result) &&
    Array.isArray((result as Record<string, unknown>)['elements'])
  );
}
