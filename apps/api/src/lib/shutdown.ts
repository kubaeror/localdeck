/**
 * Graceful-shutdown orchestration with a hard deadline.
 *
 * A stuck request (or a keep-alive socket) must not hang SIGTERM forever: the
 * app gets `timeoutMs` to drain, then the process is forced out with a
 * non-zero exit code so an orchestrator can restart it.
 */

export interface ShutdownDeps {
  /** Structured log sink (pino, or a spy in tests). */
  log: (message: string, fields?: Record<string, unknown>) => void;
  /** Stops accepting connections and waits for in-flight requests. */
  closeApp: () => Promise<void>;
  /** Destroys every memoized AWS SDK client. */
  destroyClients: () => void;
  /** Exits the process; injected so unit tests never call process.exit. */
  exit: (code: number) => void;
  /** Drain deadline in milliseconds. */
  timeoutMs: number;
  /** Timer primitives, overridable in tests (default: setTimeout/clearTimeout). */
  scheduleTimeout?: (callback: () => void, ms: number) => NodeJS.Timeout;
  cancelTimeout?: (handle: NodeJS.Timeout) => void;
}

export type ShutdownHandler = (signal: string) => Promise<void>;

/**
 * Builds the signal handler. The first signal wins; repeat signals are
 * ignored, matching the "shut down once" expectation of container runtimes.
 */
export function createShutdownHandler(deps: ShutdownDeps): ShutdownHandler {
  const scheduleTimeout = deps.scheduleTimeout ?? setTimeout;
  const cancelTimeout = deps.cancelTimeout ?? clearTimeout;
  let started = false;

  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;

    deps.log('shutting down', { signal, timeoutMs: deps.timeoutMs });

    let forced = false;
    const deadline = scheduleTimeout(() => {
      forced = true;
      deps.log('graceful shutdown deadline exceeded; forcing exit', { signal });
      deps.exit(1);
    }, deps.timeoutMs);
    // The deadline must not keep the process alive on its own.
    deadline.unref?.();

    try {
      await deps.closeApp();
      deps.destroyClients();
      deps.log('shutdown complete', { signal });
    } catch (error) {
      deps.log('graceful shutdown failed', { signal, error });
      deps.exit(1);
    } finally {
      if (!forced) cancelTimeout(deadline);
    }
  };
}
