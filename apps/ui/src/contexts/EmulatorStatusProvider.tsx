import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { getConfig, getHealth, toApiError } from '../lib/apiClient';
import {
  EmulatorStatusContext,
  type EmulatorStatusResult,
  type EmulatorStatusState,
} from './emulator-status-context';

const INITIAL_STATE: EmulatorStatusState = {
  phase: 'loading',
  config: null,
  health: null,
  error: null,
  lastCheckedAt: null,
};

/** Used until /api/config has told us the server-side poll interval. */
const FALLBACK_POLL_INTERVAL_MS = 15_000;

/**
 * Client-side bounds for the server-supplied interval. The api is trusted, but
 * the console must not be able to spin (0 ms) or stall (days) if a proxy or a
 * future api version returns something malformed.
 */
const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 600_000;

function clampPollIntervalMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return FALLBACK_POLL_INTERVAL_MS;
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, value));
}

/**
 * Single poller for emulator status, shared by the whole console (sidebar,
 * Console Home widgets, service health page). The browser never talks to the
 * emulator directly — only to the LocalDeck api proxy.
 *
 * A tick is skipped while a probe is in flight: aborting the previous request
 * on every interval would starve a slow api and the status would never update.
 */
export function EmulatorStatusProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<EmulatorStatusState>(INITIAL_STATE);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    // Skip the tick instead of aborting the probe that is still running.
    if (inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        // Config and health are fetched independently: a reachable api whose
        // emulator is down must still show the configured endpoint/provider.
        const [configResult, healthResult] = await Promise.allSettled([
          getConfig(controller.signal),
          getHealth(controller.signal),
        ]);
        if (controller.signal.aborted) return;

        if (healthResult.status === 'fulfilled') {
          setState({
            phase: healthResult.value.status === 'degraded' ? 'degraded' : 'connected',
            config: configResult.status === 'fulfilled' ? configResult.value : null,
            health: healthResult.value,
            error: null,
            lastCheckedAt: healthResult.value.checkedAt,
          });
          return;
        }

        const apiError = toApiError(healthResult.reason);
        setState((previous) => ({
          phase: apiError.statusCode === 503 ? 'unreachable' : 'error',
          // Keep the last known config (or the one that just loaded) so the
          // region/endpoint/provider stay visible.
          config: configResult.status === 'fulfilled' ? configResult.value : previous.config,
          health: null,
          error: apiError,
          // "Last checked" must reflect a successful check; a failed probe
          // keeps the previous timestamp instead of claiming a check happened.
          lastCheckedAt: previous.lastCheckedAt,
        }));
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  const pollIntervalMs = clampPollIntervalMs(state.config?.ui.statusPollIntervalMs);

  useEffect(() => {
    const timer = window.setInterval(refresh, pollIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [pollIntervalMs, refresh]);

  const value = useMemo<EmulatorStatusResult>(() => ({ ...state, refresh }), [state, refresh]);

  return <EmulatorStatusContext.Provider value={value}>{children}</EmulatorStatusContext.Provider>;
}
