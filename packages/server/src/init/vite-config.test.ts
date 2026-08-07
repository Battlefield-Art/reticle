import { describe, expect, it } from 'vitest';
import { patchViteConfig, VitePatchKind, VITE_IMPORT } from './vite-config.js';

const BASIC = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

describe('patchViteConfig', () => {
  it('adds the import and reticle() into the plugins array', () => {
    const r = patchViteConfig(BASIC);
    expect(r.kind).toBe(VitePatchKind.APPLY);
    if (r.kind !== VitePatchKind.APPLY) return;
    expect(r.code).toContain(VITE_IMPORT);
    expect(r.code).toMatch(/plugins:\s*\[reticle\(\),\s*react\(\)\]/);
  });

  it('places the import after the last existing import', () => {
    const r = patchViteConfig(BASIC);
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    const importIdx = r.code.indexOf(VITE_IMPORT);
    const exportIdx = r.code.indexOf('export default');
    expect(importIdx).toBeGreaterThan(0);
    expect(importIdx).toBeLessThan(exportIdx);
  });

  it('is idempotent — already-patched configs are left alone', () => {
    const r = patchViteConfig(BASIC);
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    expect(patchViteConfig(r.code).kind).toBe(VitePatchKind.ALREADY);
  });

  it('bakes a non-default port into the reticle() call', () => {
    const r = patchViteConfig(BASIC, 5000);
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    expect(r.code).toContain('reticle({ port: 5000 })');
  });

  it('emits bare reticle() when no port is given', () => {
    const r = patchViteConfig(BASIC);
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    // Spaced to match the line it lands on: single-line arrays keep the space, multi-line ones
    // would otherwise be left with trailing whitespace for a formatter to rewrite.
    expect(r.code).toContain('reticle(),');
    expect(r.code).not.toContain('port:');
  });

  it('bails to manual when there is no plugins array', () => {
    const r = patchViteConfig(`import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 3000 } });
`);
    expect(r.kind).toBe(VitePatchKind.MANUAL);
  });

  it('prepends the import when the config has none', () => {
    const r = patchViteConfig('export default { plugins: [] };\n');
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    expect(r.code.startsWith(VITE_IMPORT)).toBe(true);
  });
});

/**
 * The patch lands in somebody's source file, so it has to look like something a person wrote. A
 * trailing space before a newline is exactly what a formatter rewrites, turning a one-line install
 * into a diff against the user's own style.
 */
describe('patchViteConfig — the edit reads like the file it lands in', () => {
  it('leaves no trailing whitespace on the plugins line', () => {
    const src = `import { defineConfig } from 'vite';\nexport default defineConfig({\n  plugins: [\n    react(),\n  ],\n});\n`;
    const r = patchViteConfig(src);
    if (r.kind !== VitePatchKind.APPLY) throw new Error('expected apply');
    for (const line of r.code.split('\n')) {
      expect(line, JSON.stringify(line)).toBe(line.replace(/\s+$/, ''));
    }
  });
});
