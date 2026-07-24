import { relative } from 'node:path';
import type { PluginObj, PluginPass, types as BabelTypes } from '@babel/core';

/** The attribute this plugin stamps (mirrors DATA_RETICLE_SOURCE_ATTR in @reticlehq/core). */
const SOURCE_ATTR = 'data-reticle-source';

interface PluginApi {
  types: typeof BabelTypes;
}

/**
 * Stamps `data-reticle-source="relativeFile:line:col"` on every JSX host element (lowercase
 * tag). @reticlehq/react reads it to map a DOM node back to its source — needed on React 19,
 * which removed `_debugSource`. Intended for dev builds only.
 *
 * Exported with `export =` (CommonJS module.exports) — Babel loads a plugin via `require()` and takes
 * the module object directly, so this ships as `module.exports = fn` with no `__esModule`/`default`
 * interop wrapper (which some bundlers mishandle on a default import). The attribute name rides as a
 * property for the rare consumer that wants it: `require('@reticlehq/babel-plugin').SOURCE_ATTR`.
 */
function reticleSourcePlugin({ types: t }: PluginApi): PluginObj<PluginPass> {
  return {
    name: 'reticle-source',
    visitor: {
      JSXOpeningElement(path, state: PluginPass) {
        const node = path.node;
        // Host elements only (e.g. <div>, <button>) — skip components (<App />).
        if (node.name.type !== 'JSXIdentifier') return;
        const first = node.name.name[0];
        if (first === undefined || first !== first.toLowerCase()) return;

        const alreadyStamped = node.attributes.some(
          (attr) =>
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === SOURCE_ATTR,
        );
        if (alreadyStamped) return;

        const loc = node.loc;
        if (loc === null || loc === undefined) return;

        const filename = state.filename ?? 'unknown';
        const rel = relative(process.cwd(), filename);
        const value = `${rel}:${String(loc.start.line)}:${String(loc.start.column)}`;

        node.attributes.push(t.jsxAttribute(t.jsxIdentifier(SOURCE_ATTR), t.stringLiteral(value)));
      },
    },
  };
}

reticleSourcePlugin.SOURCE_ATTR = SOURCE_ATTR;

export = reticleSourcePlugin;
