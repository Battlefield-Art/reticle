import { describe, expect, it } from 'vitest';
import { installExitTrace } from './daemon-resilience.js';

/**
 * A daemon that dies must leave a line saying so.
 *
 * Reported from the field: a 115-line log with zero of `reticle_daemon_idle_exit`,
 * `reticle_daemon_close_error`, `daemon_stopped`, `uncaught` or `unhandled`. The crash handlers all
 * log before exiting, so their silence ruled them out and left nothing else to read — the daemon
 * stopped existing mid-wait and no shutdown path had run.
 *
 * With every in-process door instrumented, the NEXT occurrence is decisive either way: a line names
 * the exit, or the absence of one narrows it to SIGKILL / OOM, which nothing in-process can log.
 */
describe('installExitTrace — every door out is instrumented', () => {
  const wire = () => {
    const handlers = new Map<string, (arg: unknown) => void>();
    const logged: { event: string; data: Record<string, unknown> }[] = [];
    installExitTrace(
      {
        on(event: string, listener: (arg: unknown) => void) {
          handlers.set(event, listener);
          return undefined;
        },
      },
      (event, data) => void logged.push({ event, data }),
    );
    return { handlers, logged };
  };

  it('logs the exit code on a normal or explicit exit', () => {
    const { handlers, logged } = wire();
    handlers.get('exit')?.(0);
    expect(logged).toEqual([{ event: 'reticle_daemon_exiting', data: { code: 0 } }]);
  });

  it('carries a non-zero code, which is what distinguishes a crash from a clean stop', () => {
    const { handlers, logged } = wire();
    handlers.get('exit')?.(1);
    expect(logged[0]?.data['code']).toBe(1);
  });

  it('names the signal on an external kill', () => {
    const { handlers, logged } = wire();
    handlers.get('SIGTERM')?.(undefined);
    expect(logged).toEqual([{ event: 'reticle_daemon_signalled', data: { signal: 'SIGTERM' } }]);
  });

  it('covers the signals a supervisor or shell actually sends', () => {
    const { handlers } = wire();
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      expect(handlers.has(signal), `${signal} must be traced`).toBe(true);
    }
  });

  it('does not exit on a signal — the real shutdown still needs to flush', () => {
    const { handlers, logged } = wire();
    handlers.get('SIGINT')?.(undefined);
    // Only a log. Exiting here would race the shutdown that sends the session summary.
    expect(logged).toHaveLength(1);
  });
});
