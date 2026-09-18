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
  LocalStackStatusContext,
  type LocalStackStatusState,
  type UseLocalStackStatusResult,
} from './localstack-status-context';

const INITIAL_STATE: LocalStackStatusState = {
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
 * Single poller for LocalStack status, shared by the whole console (sidebar,
 * Console Home widgets, service health page). The browser never talks to
 * LocalStack directly — only to the LocalDeck api proxy.
 */
export function LocalStackStatusProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<LocalStackStatusState>(INITIAL_STATE);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    void (async () => {
      try {
        const [config, health] = await Promise.all([
          getConfig(controller.signal),
          getHealth(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setState({
          phase: health.status === 'degraded' ? 'degraded' : 'connected',
          config,
          health,
          error: null,
          lastCheckedAt: health.checkedAt,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const apiError = toApiError(error);
        setState((previous) => ({
          phase: apiError.statusCode === 503 ? 'unreachable' : 'error',
          // Keep the last known config so the region/endpoint stay visible.
          config: previous.config,
          health: null,
          error: apiError,
          lastCheckedAt: new Date().toISOString(),
        }));
      }
    })();
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      inFlight.current?.abort();
    };
  }, [refresh]);

  const pollIntervalMs = clampPollIntervalMs(state.config?.ui.statusPollIntervalMs);

  useEffect(() => {
    const timer = window.setInterval(refresh, pollIntervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [pollIntervalMs, refresh]);

  const value = useMemo<UseLocalStackStatusResult>(() => ({ ...state, refresh }), [state, refresh]);

  return (
    <LocalStackStatusContext.Provider value={value}>{children}</LocalStackStatusContext.Provider>
  );
}
