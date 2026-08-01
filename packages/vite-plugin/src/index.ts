import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from '@babel/core';
import reticleSource from '@reticlehq/babel-plugin';
import { RETICLE_DEFAULT_PORT, bridgeWsUrl, ReticleDir, ReticleEnv } from '@reticlehq/core';
import { resolveProjectId } from './project-id.js';
import { discoverDaemonPort } from './discover-port.js';

export const RETICLE_VITE_PLUGIN_NAME = 'reticle';

// The React kit the host app imports the SDK from. It re-exports the browser sensor, so a single
// specifier yields both `reticle` (connect) and `install` (the React adapter). NOT `@reticlehq/core`
// — that is the isomorphic foundation and exports neither.
const RETICLE_PACKAGE = '@reticlehq/react';
/** Files we stamp with source info — JSX/TSX only. */
const JSX_FILE = /\.[jt]sx$/;
/** Rollup virtual-module ids start with a NUL byte; never transform those. */
const VIRTUAL_PREFIX = '\0';
const NODE_MODULES = 'node_modules';

/**
 * The connect code is served as a real module (not an inline <script>) so that Vite's import
 * pipeline resolves the bare `@reticlehq/react` specifier. An inline injected script is NOT run through
 * import resolution, so its bare import would fail in the browser. This path-like id is requested
 * by the injected <script src> and served by the load hook below.
 */
export const RETICLE_CONNECT_MODULE = '/@reticle-connect';

/**
 * How long after serving the HTML to wait before concluding the entry was never injected.
 *
 * Generous on purpose: the browser has to request the entry, and a cold dev server transforming a
 * large app can take a moment. A false warning would train people to ignore a real one.
 */
const DEV_INJECTION_GRACE_MS = 10_000;

export interface ReticleVitePluginOptions {
  /** Bridge WebSocket port. Defaults to the SDK default; only baked into connect when non-default. */
  port?: number;
  /** Stable session label for the bridge. Defaults to the SDK's auto-generated id. */
  session?: string;
  /**
   * Stable project identity. Defaults to one derived from the app's package.json name + root path,
   * so multi-project session scoping works with zero config. Override only for special setups.
   */
  projectId?: string;
  /** Auth token forwarded to connect when the bridge requires one. */
  token?: string;
  /** Stamp data-reticle-source for React 19 source mapping. Default true (harmless on React <=18). */
  sourceMapping?: boolean;
  /** Auto-inject the dev-gated reticle.connect call. Default true. */
  inject?: boolean;
  /**
   * This build is an Electron/Tauri renderer. Changes two things a desktop shell needs and a web app
   * must not get:
   *
   *  - The plugin also applies to `vite build`. A packaged desktop renderer IS a production build
   *    loaded from `file://` or a custom protocol — there is no dev server — so the default
   *    `apply: 'serve'` drops the plugin entirely and the app ships with no `connect()` at all.
   *  - `connect()` is called with `allowInProduction`, because that same renderer reports
   *    NODE_ENV=production and the SDK's prod backstop would otherwise refuse to start.
   *
   * Off by default and never inferred: turning it on means an instrumented production BUNDLE, which
   * is exactly what a web app must never ship. Keep it behind your own dev-only build (a dev target,
   * or `process.env.NODE_ENV !== 'production'` in vite.config) so it cannot reach a release binary.
   */
  desktop?: boolean;
  /**
   * Where a diagnostic goes. Defaults to the console; injected so the dev-mode injection check is
   * testable without capturing global console output.
   */
  onWarn?: (message: string) => void;
}

/** Structural Vite plugin shape — avoids a hard dependency on `vite` while staying assignable to its `Plugin`. */
export interface ReticleVitePlugin {
  name: string;
  /** Absent in desktop mode, where the plugin must also run for `vite build`. */
  apply?: 'serve';
  enforce: 'pre';
  transform: (code: string, id: string) => { code: string; map: string | null } | null;
  resolveId: (id: string, importer?: string) => string | null;
  load: (id: string) => string | null;
  transformIndexHtml: (html: string) => HtmlTag[];
  /** Vite hands over the resolved config; used to resolve the HTML entry exactly. */
  configResolved?: (config: { root?: string; command?: string }) => void;
  /** Build-time post-condition: desktop injection must have happened. */
  buildEnd?: () => void;
  /** Runs the dev-mode injection check immediately. Test seam for the deferred timer. */
  checkInjectedForTest?: () => void;
}

interface HtmlTag {
  tag: string;
  attrs: Record<string, string>;
  injectTo: 'body';
}

/**
 * Is this resolved module id the one the HTML referenced?
 *
 * `resolveId` sees the specifier (`/src/main.tsx`); `transform` sees the absolute path
 * (`/Users/me/app/src/main.tsx`). A suffix match is what bridges them. Any query suffix
 * (`?html-proxy`, `?t=...`) is stripped first so a re-transformed module still matches.
 */
function isHtmlEntry(id: string, specifier: string | undefined, root: string | undefined): boolean {
  if (specifier === undefined) return false;
  const clean = (value: string): string => value.split('?')[0] ?? value;
  const target = clean(specifier);
  const candidate = clean(id);
  if (candidate === target) return true;
  // EXACT when the resolved root is known: Vite reports the HTML's script as a root-relative
  // specifier (`/src/main.tsx`) while `transform` sees the absolute path, and joining the two is a
  // real resolution rather than a guess. Suffix matching alone would also inject into
  // `/other/src/main.tsx`, a different file that merely ends the same way.
  if (root !== undefined && target.startsWith('/')) {
    return candidate === `${root.replace(/\/$/, '')}${target}`;
  }
  // Fallback for the rare case Vite never reported a root — still better than not injecting, and the
  // buildEnd post-condition means a wrong match cannot pass unnoticed as "nothing happened".
  return candidate.endsWith(target.startsWith('/') ? target : `/${target}`);
}

function shouldStamp(id: string): boolean {
  if (id.startsWith(VIRTUAL_PREFIX)) return false;
  if (id.includes(NODE_MODULES)) return false;
  // Strip any query suffix (?worker, ?raw,...) before matching the extension.
  const clean = id.split('?')[0] ?? id;
  return JSX_FILE.test(clean);
}

function stamp(code: string, id: string): { code: string; map: string | null } | null {
  const out = transformSync(code, {
    filename: id,
    plugins: [reticleSource],
    parserOpts: { plugins: ['jsx', 'typescript'] },
    sourceMaps: true,
    configFile: false,
    babelrc: false,
  });
  if (out?.code === undefined || out.code === null) return null;
  return {
    code: out.code,
    map: out.map === undefined || out.map === null ? null : JSON.stringify(out.map),
  };
}

/**
 * Read the daemon's auto-provisioned pairing token (~/.reticle/pairing-token, or the
 * RETICLE_PAIRING_TOKEN_DIR override) so the served app can present it. Node-side only — a browser
 * sandbox can't read the file, which is exactly why a rogue localhost app can't forge it. Best-effort:
 * undefined if the daemon hasn't started yet (the page reloads once it has). Exported for testing.
 */
export function readPairingToken(): string | undefined {
  const override = process.env[ReticleEnv.PAIRING_TOKEN_DIR];
  const dir =
    override !== undefined && override.length > 0 ? override : join(homedir(), ReticleDir.ROOT);
  try {
    const token = readFileSync(join(dir, ReticleDir.PAIRING_TOKEN_FILE), 'utf8').trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

/** Build the `reticle.connect` argument literal — only includes keys the user set. */
function connectArgs(options: ReticleVitePluginOptions): string {
  const args: Record<string, string | number | boolean> = {};
  const port = options.port ?? RETICLE_DEFAULT_PORT;
  if (port !== RETICLE_DEFAULT_PORT) args['url'] = bridgeWsUrl(port);
  if (options.session !== undefined) args['session'] = options.session;
  if (options.projectId !== undefined) args['projectId'] = options.projectId;
  if (options.token !== undefined) args['token'] = options.token;
  // A desktop renderer is a production build by construction; without this the SDK's prod backstop
  // refuses to connect and the app is silently uninstrumented.
  if (options.desktop === true) args['allowInProduction'] = true;
  return Object.keys(args).length > 0 ? JSON.stringify(args) : '';
}

/** The body of the connect module — real imports, resolved by Vite when the module is served. */
export function connectModuleSource(options: ReticleVitePluginOptions): string {
  const args = connectArgs(options);
  return `import { reticle, install } from '${RETICLE_PACKAGE}';\ninstall();\nreticle.connect(${args});\n`;
}

/**
 * Reticle Vite plugin. Add to your `plugins` array and the entire integration is done:
 *
 * import { reticle } from '@reticlehq/vite-plugin';
 * export default defineConfig({ plugins: [react(), reticle()] });
 *
 * `apply: 'serve'` means Vite drops the plugin entirely from `vite build`, so a web production
 * bundle is never instrumented — gating is the tool's job, not a user-managed env check.
 *
 * `desktop: true` is the ONE documented exception, and it inverts that guarantee deliberately: a
 * packaged Electron/Tauri renderer IS a production build with no dev server, so serve-only gating
 * would ship an app with no connect() at all. The cost is that the flag hands gating back to the
 * caller — keep it behind your own dev-only build target so an instrumented bundle can never reach
 * a release binary.
 */
export function reticle(options: ReticleVitePluginOptions = {}): ReticleVitePlugin {
  const sourceMapping = options.sourceMapping !== false;
  const inject = options.inject !== false;
  const desktop = options.desktop === true;
  // Resolve the stable projectId once (explicit option, else derived from package.json + cwd) so the
  // app is identifiable across port changes with zero config.
  const resolved: ReticleVitePluginOptions = {
    ...options,
    projectId: resolveProjectId(options.projectId, process.cwd()),
  };
  /**
   * The specifier the HTML points at, e.g. `/src/main.tsx`.
   *
   * Stored UNRESOLVED, because that is what `resolveId` receives — while `transform` is handed the
   * absolute resolved path. Comparing the two directly never matches, and the failure is silent:
   * the bundle simply ships with no connect() in it. Hence `isHtmlEntry`'s suffix comparison.
   */
  let htmlEntrySpecifier: string | undefined;
  /** Vite's resolved project root, for exact entry resolution. Undefined until configResolved. */
  let root: string | undefined;
  /** 'serve' | 'build'. The dev check only applies to serve; buildEnd covers the other. */
  let command: string | undefined;
  const warn = options.onWarn ?? ((message: string) => globalThis.console.warn(message));
  /** Whether connect() actually reached a module — asserted at buildEnd, never assumed. */
  let injected = false;
  /**
   * Resolve port + token at the moment of injection, not at plugin construction. By the time a
   * module is served or built the daemon is up and has written its pairing token; resolving early
   * would bake in `undefined` and the app would fail auth on every connect.
   */
  const resolveLazy = (): ReticleVitePluginOptions => {
    const port = resolved.port ?? discoverDaemonPort(resolved.projectId);
    const withPort = port !== undefined ? { ...resolved, port } : resolved;
    const token = withPort.token ?? readPairingToken();
    return token !== undefined ? { ...withPort, token } : withPort;
  };
  /** The one message, so the build error and the dev warning cannot drift apart. */
  const notInjectedMessage = (): string =>
    `[${RETICLE_VITE_PLUGIN_NAME}] could not inject reticle.connect(): the HTML entry module was ` +
    'never matched, so this app carries no instrumentation and will never connect. Check that ' +
    'index.html references your entry with a <script type="module" src="...">, or pass ' +
    '`inject: false` and call reticle.connect() yourself.';

  /** Warn (never throw) in dev — a running dev server should report the fault, not die of it. */
  const checkInjected = (): void => {
    if (!desktop || !inject || injected) return;
    warn(notInjectedMessage());
  };

  return {
    name: RETICLE_VITE_PLUGIN_NAME,
    // Web: serve-only, so a production bundle can never carry the SDK — gating is the tool's job.
    // Desktop: a packaged renderer IS a production build with no dev server, so the plugin must also
    // run for `vite build` or the shipped app has no connect() at all.
    ...(options.desktop === true ? {} : { apply: 'serve' as const }),
    enforce: 'pre',
    transform(code, id) {
      // Desktop injection: prepend connect() to the HTML's own entry module. It is a REAL module, so
      // its bare `@reticlehq/react` import resolves through the normal pipeline in both dev and
      // build — which a virtual <script src> only ever did in dev.
      if (desktop && inject && isHtmlEntry(id, htmlEntrySpecifier, root)) {
        injected = true;
        const withConnect = `${connectModuleSource(resolveLazy())}\n${code}`;
        const stamped = sourceMapping && shouldStamp(id) ? stamp(withConnect, id) : null;
        return stamped ?? { code: withConnect, map: null };
      }
      if (!sourceMapping || !shouldStamp(id)) return null;
      return stamp(code, id);
    },
    resolveId(id, importer) {
      // Desktop: remember the module the HTML points at, so `transform` can prepend connect() into
      // it. A packaged build has no dev server, so the serve-time trick below — a <script src> at a
      // virtual URL — would emit a tag pointing at a file that does not exist. That shipped an app
      // with a dead script and NO instrumentation, which is worse than not injecting at all.
      // `includes`, not `endsWith`: in a BUILD Vite rewrites the html entry through an html-proxy
      // id (`/index.html?html-proxy&index=0.js`), so an endsWith check silently never matches and
      // nothing is injected — which is exactly how this shipped a bundle with no connect() in it.
      if (desktop && inject && importer !== undefined && importer.includes('.html')) {
        htmlEntrySpecifier = id;
      }
      // Return the id verbatim so Vite serves it back to load (the bare imports inside it then
      // go through normal resolution). No NUL prefix: the browser requests it as a URL.
      return inject && id === RETICLE_CONNECT_MODULE ? RETICLE_CONNECT_MODULE : null;
    },
    load(id) {
      if (!inject || id !== RETICLE_CONNECT_MODULE) return null;
      return connectModuleSource(resolveLazy());
    },
    configResolved(config) {
      root = config.root;
      command = config.command;
    },
    /**
     * Desktop injection is silent when it misses — the bundle simply has no connect() in it and the
     * app looks wired while reporting nothing. That happened twice while this was being built. A
     * build that could not instrument must fail loudly instead of shipping a binary that lies.
     */
    buildEnd() {
      if (!desktop || !inject || injected) return;
      throw new Error(notInjectedMessage());
    },
    checkInjectedForTest: checkInjected,
    transformIndexHtml() {
      // In serve, the HTML is sent BEFORE the browser requests the entry module, so the check has to
      // be deferred — asserting here would fire on every healthy start. Unref'd so a dev server is
      // never held open by it.
      if (desktop && inject && command === 'serve') {
        const timer = setTimeout(checkInjected, DEV_INJECTION_GRACE_MS);
        (timer as { unref?: () => void }).unref?.();
      }
      // Desktop injects via the entry module instead (see transform) — a tag here would be a dead
      // URL in a packaged build.
      if (!inject || desktop) return [];
      return [
        { tag: 'script', attrs: { type: 'module', src: RETICLE_CONNECT_MODULE }, injectTo: 'body' },
      ];
    },
  };
}
