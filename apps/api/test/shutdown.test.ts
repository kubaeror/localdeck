import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, type ShutdownDeps } from '../src/lib/shutdown.js';

/** Runs a shutdown handler with fake timers and recorded side effects. */
function harness(overrides: Partial<ShutdownDeps> = {}) {
  const logs: string[] = [];
  const exits: number[] = [];
  const callbacks: (() => void)[] = [];
  const cleared: NodeJS.Timeout[] = [];

  const handler = createShutdownHandler({
    log: (message) => logs.push(message),
    closeApp: async () => {},
    destroyClients: () => logs.push('clients destroyed'),
    exit: (code) => exits.push(code),
    timeoutMs: 1000,
    scheduleTimeout: (callback) => {
      callbacks.push(callback);
      return { unref: () => undefined } as unknown as NodeJS.Timeout;
    },
    cancelTimeout: (handle) => {
      cleared.push(handle);
    },
    ...overrides,
  });

  return {
    handler,
    logs,
    exits,
    callbacks,
    cleared,
    fireDeadline: () => callbacks.forEach((callback) => callback()),
  };
}

describe('createShutdownHandler (API-022)', () => {
  it('closes the app, destroys clients and clears the deadline', async () => {
    const done = vi.fn(async () => {});
    const h = harness({ closeApp: done });

    await h.handler('SIGTERM');

    expect(done).toHaveBeenCalledTimes(1);
    expect(h.logs).toContain('clients destroyed');
    expect(h.logs).toContain('shutdown complete');
    expect(h.exits).toEqual([]);
    expect(h.cleared).toHaveLength(1);
  });

  it('forces exit when the drain deadline fires first', async () => {
    const h = harness({
      closeApp: () => new Promise<void>(() => undefined),
    });

    const pending = h.handler('SIGTERM');
    h.fireDeadline();

    expect(h.exits).toEqual([1]);
    // The handler itself stays pending: the process would already be exiting.
    await Promise.race([pending, Promise.resolve()]);
  });

  it('exits non-zero when the app close fails', async () => {
    const h = harness({
      closeApp: async () => {
        throw new Error('close failed');
      },
    });

    await h.handler('SIGTERM');

    expect(h.exits).toEqual([1]);
    expect(h.logs).toContain('graceful shutdown failed');
    // The deadline is still cleared so the process can exit normally.
    expect(h.cleared).toHaveLength(1);
  });

  it('ignores repeat signals once shutdown started', async () => {
    const done = vi.fn(async () => {});
    const h = harness({ closeApp: done });

    await Promise.all([h.handler('SIGTERM'), h.handler('SIGTERM')]);

    expect(done).toHaveBeenCalledTimes(1);
  });
});
