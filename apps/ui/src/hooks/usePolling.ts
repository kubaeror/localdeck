import { useEffect, useRef } from 'react';

export interface UsePollingOptions {
  /**
   * Runs one tick as soon as polling becomes active, instead of waiting a full
   * interval. Used by detail pages that want the first refresh immediately.
   */
  immediate?: boolean;
}

/** Interval bounds: a malformed caller must never spin or effectively stop polling. */
const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 600_000;

/**
 * Runs `callback` every `intervalMs` while `active` is true. The callback is
 * held in a ref, so an inline closure does not restart the interval on every
 * render. Used by the EC2/EKS pages to auto-refresh while a resource is still
 * settling (pending / stopping / shutting-down).
 *
 * The hook owns a busy guard: a slow asynchronous callback is never overlapped
 * by the next tick. Passing `{ immediate: true }` fires one tick up front.
 */
export function usePolling(
  active: boolean,
  intervalMs: number,
  callback: () => void | Promise<void>,
  options: UsePollingOptions = {},
): void {
  const callbackRef = useRef(callback);
  const busyRef = useRef(false);
  const immediate = options.immediate === true;

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;
    const interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, intervalMs));

    const tick = (): void => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = callbackRef.current();
        if (result instanceof Promise) {
          void result
            .catch(() => {
              // The caller reports its own failures; polling must continue.
            })
            .finally(() => {
              busyRef.current = false;
            });
        } else {
          busyRef.current = false;
        }
      } catch {
        busyRef.current = false;
      }
    };

    if (immediate) tick();
    const timer = window.setInterval(tick, interval);
    return () => {
      window.clearInterval(timer);
      busyRef.current = false;
    };
  }, [active, immediate, intervalMs]);
}
