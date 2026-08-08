/**
 * Wiring Reticle into a Create React App project.
 *
 * CRA had no automated path: init reported `⚠ Connect snippet → index.html`, a target that cannot
 * work. CRA's `public/index.html` is a static template the bundler never processes for modules, so a
 * bare import in it resolves to nothing. `src/index.tsx` is what gets bundled, and that is where the
 * connect has to arrive.
 *
 * The token is the second half of the problem. Every other stack has somewhere to inline it —
 * Vite defines `__RETICLE_TOKEN__`, the Astro and HTML snippets read the file in Node. `src/index.tsx`
 * is browser code inside a bundler that inlines exactly one thing: environment variables prefixed
 * `REACT_APP_`. So it travels through `.env.development.local`, which is CRA's own documented
 * mechanism and is gitignored by CRA's own template.
 */

/** The line added to `src/index.tsx`. Side-effect import: the module guards itself on NODE_ENV. */
export const CRA_DEV_MODULE_IMPORT = "import './reticle-dev';";
export const CRA_DEV_MODULE_PATH = 'src/reticle-dev.ts';
export const CRA_ENV_PATH = '.env.development.local';
const TOKEN_VAR = 'REACT_APP_RETICLE_TOKEN';

/** Add the import after the last existing one, or null when it is already present. */
export function craImportPatch(source: string): string | null {
  if (source.includes(CRA_DEV_MODULE_IMPORT)) return null;
  const lines = source.split('\n');
  // After the LAST import: React's own imports must still run first, and a side-effect import placed
  // above them would connect before the app exists.
  let lastImport = -1;
  for (const [index, line] of lines.entries()) {
    if (/^\s*import\s/.test(line)) lastImport = index;
  }
  lines.splice(lastImport + 1, 0, CRA_DEV_MODULE_IMPORT);
  return lines.join('\n');
}

/** Set the token variable, or null when nothing needs to change. */
export function craEnvPatch(existing: string | null, token: string): string | null {
  if (token === '') return null;
  const line = `${TOKEN_VAR}=${token}`;
  if (existing === null || existing.trim() === '') return `${line}\n`;
  if (existing.includes(line)) return null;
  // Replace rather than append: two assignments of one variable is a silent coin flip on which wins.
  if (new RegExp(`^${TOKEN_VAR}=`, 'm').test(existing)) {
    return existing.replace(new RegExp(`^${TOKEN_VAR}=.*$`, 'm'), line);
  }
  return `${existing.endsWith('\n') ? existing : `${existing}\n`}${line}\n`;
}

/** The dev-only connect module imported from `src/index.tsx`. */
export function craDevModuleFile(port: number | undefined, projectId?: string): string {
  const fields: string[] = [];
  if (port !== undefined) fields.push(`url: 'ws://127.0.0.1:${String(port)}/reticle'`);
  if (projectId !== undefined && projectId.length > 0) fields.push(`projectId: '${projectId}'`);
  const inline = fields.length > 0 ? `${fields.join(', ')}, ` : '';
  return `// Dev-only: connect Reticle. Imported for its side effect from src/index.tsx.
//
// CRA's public/index.html is a static template the bundler never processes for modules, so the
// connect cannot live there. The pairing token arrives through REACT_APP_RETICLE_TOKEN because
// REACT_APP_* is the only thing CRA inlines into browser code.
if (process.env.NODE_ENV === 'development') {
  void import('@reticlehq/react').then(({ reticle, install }) => {
    install();
    const token = process.env.${TOKEN_VAR} ?? '';
    reticle.connect({ ${inline}...(token.length > 0 ? { token } : {}) });
  });
}

export {};
`;
}
