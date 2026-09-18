import type { ApiError } from '@localdeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../../lib/apiClient';

/**
 * Request lifecycle shared by the EC2 detail pages and tabs. Every one of them
 * used to duplicate the same requestId/loading/error boilerplate; this hook
 * keeps one implementation of cancellation safety in one place.
 */

export interface Ec2Resource<T> {
  data: T | null;
  /** True until the first load for the current loader settles. */
  loading: boolean;
  /** True while a later reload is in flight (the data stays on screen). */
  refreshing: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

/**
 * Loads one resource with a monotonic request guard: a slow response from a
 * previous loader or reload can never overwrite the newest one. The `loader`
 * must be stable (`useCallback`), because a new identity is treated as a new
 * resource: the hook clears the previous data and shows the full loading state.
 */
export function useEc2Resource<T>(loader: () => Promise<T>): Ec2Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);
  const firstLoadDone = useRef(false);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const reload = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    if (firstLoadDone.current) setRefreshing(true);
    try {
      const result = await loaderRef.current();
      if (requestId.current !== id) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setData(null);
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) {
        firstLoadDone.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // A new loader means a new resource: reset to the full-page loading state
    // instead of showing the previous resource's data under the new id.
    firstLoadDone.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route resource fetch
    setLoading(true);
    setData(null);
    setError(null);
    void reload();
    return () => {
      requestId.current += 1;
    };
  }, [loader, reload]);

  return { data, loading, refreshing, error, reload };
}

/** How long an action keeps polling even when the first refetch looks settled. */
export const ACTION_TRACKING_WINDOW_MS = 30_000;

export interface TransitionTracking {
  /** True while the post-action tracking window is open. */
  forcedTracking: boolean;
  /** Opens (or extends) the tracking window; call after a mutating action. */
  trackTransition: () => void;
}

/**
 * Post-action polling window. Polling otherwise follows the *observed* state,
 * so an eventually-consistent first refetch that already reports `running`
 * would stop the timer while LocalStack is still settling. An action opens a
 * short window of guaranteed refreshes regardless of what the first fetch saw.
 */
export function useTransitionTracking(): TransitionTracking {
  const [forcedTracking, setForcedTracking] = useState(false);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const trackTransition = useCallback((): void => {
    setForcedTracking(true);
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setForcedTracking(false);
    }, ACTION_TRACKING_WINDOW_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { forcedTracking, trackTransition };
}
