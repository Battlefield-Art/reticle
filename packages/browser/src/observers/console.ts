/* eslint-disable no-console -- this module's whole purpose is to wrap the console.* methods */
import { EventType } from '@reticlehq/core';
import type { Emit, Teardown } from './types.js';
import { safeStringify } from '../security/serialization.js';

type ConsoleMethod = 'log' | 'warn' | 'error' | 'info' | 'debug';

const METHOD_EVENT: Record<ConsoleMethod, EventType> = {
  log: EventType.CONSOLE_LOG,
  warn: EventType.CONSOLE_WARN,
  error: EventType.CONSOLE_ERROR,
  // info/debug are captured for the raw console channel but excluded from summaries/deviation reports
  // (low signal — most apps chatter here). Lean: no stack, like log/warn.
  info: EventType.CONSOLE_INFO,
  debug: EventType.CONSOLE_DEBUG,
};

function stringifyArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      return safeStringify(a);
    })
    .join(' ');
}

/** Stacks can be long; cap so a deep async trace never blows the event budget. */
const MAX_STACK_LEN = 4000;

function capStack(stack: string | undefined): string | undefined {
  if (stack === undefined || stack.length === 0) return undefined;
  return stack.length > MAX_STACK_LEN ? stack.slice(0, MAX_STACK_LEN) : stack;
}

/** The stack of the first Error argument, if any — the single biggest diagnosis upgrade, near-zero cost. */
function firstErrorStack(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (arg instanceof Error) return capStack(arg.stack);
  }
  return undefined;
}

/** Patch console.{log,warn,error} and window error events. Reversible. */
export function installConsole(emit: Emit): Teardown {
  const methods: ConsoleMethod[] = ['log', 'warn', 'error', 'info', 'debug'];
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

  for (const method of methods) {
    // Store the true original for teardown identity; call through a bound copy.
    const original = console[method] as (...args: unknown[]) => void;
    originals.set(method, original);
    const callOriginal = original.bind(console);
    console[method] = (...args: unknown[]): void => {
      // Only console.error carries a stack — the diagnosis case; log/warn stay lean.
      const stack = method === 'error' ? firstErrorStack(args) : undefined;
      emit(METHOD_EVENT[method], {
        message: stringifyArgs(args),
        ...(stack === undefined ? {} : { stack }),
      });
      callOriginal(...args);
    };
  }

  const onError = (event: ErrorEvent): void => {
    const stack = capStack(event.error instanceof Error ? event.error.stack : undefined);
    emit(EventType.ERROR_UNCAUGHT, {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      ...(stack === undefined ? {} : { stack }),
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason: unknown = event.reason;
    const stack = capStack(reason instanceof Error ? reason.stack : undefined);
    emit(EventType.ERROR_UNCAUGHT, {
      message: reason instanceof Error ? reason.message : String(reason),
      kind: 'unhandledrejection',
      ...(stack === undefined ? {} : { stack }),
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    for (const [method, original] of originals) {
      console[method] = original as typeof console.log;
    }
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
