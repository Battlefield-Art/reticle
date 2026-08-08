import { describe, expect, it } from 'vitest';
import { claudeAddCommand, claudeExistsProbe, mcpManual, MCP_SERVER_NAME } from './mcp.js';

describe('claudeAddCommand', () => {
  it('registers reticle at user scope via npx (global, all projects)', () => {
    const c = claudeAddCommand();
    expect(c.command).toBe('claude');
    expect(c.args).toEqual([
      'mcp',
      'add',
      MCP_SERVER_NAME,
      '-s',
      'user',
      '--',
      'npx',
      '@reticlehq/server',
      'mcp',
    ]);
  });

  it('is portless — never bakes a port into the global registration', () => {
    // A single global entry serves every project; the port is resolved per-project from
    //.reticle.json at runtime. Baking --port here would pin all projects to one port.
    const c = claudeAddCommand();
    expect(c.args).not.toContain('--port');
    expect(c.display).not.toContain('--port');
    expect(c.display).toBe('claude mcp add reticle -s user -- npx @reticlehq/server mcp');
  });
});

describe('claudeExistsProbe', () => {
  it('asks about the SAME scope it registers in', () => {
    // Unscoped, `claude mcp get reticle` exits 0 for a PROJECT-scoped entry in some unrelated repo
    // the user once ran init in — so the global registration was skipped and reported done, and the
    // agent had Reticle in one directory and nowhere else.
    expect(claudeExistsProbe()).toEqual({
      command: 'claude',
      args: ['mcp', 'get', 'reticle', '-s', 'user'],
    });
  });

  it('matches the scope claudeAddCommand writes', () => {
    const added = claudeAddCommand().args;
    const probed = claudeExistsProbe().args;
    const scopeOf = (args: string[]): string | undefined => args[args.indexOf('-s') + 1];
    expect(scopeOf(probed)).toBe(scopeOf(added));
  });
});

describe('mcpManual', () => {
  it('explains the one-time global registration', () => {
    const m = mcpManual();
    expect(m).toContain('claude mcp add reticle -s user');
    expect(m).toContain('globally');
    expect(m).not.toContain('--port');
  });
});
