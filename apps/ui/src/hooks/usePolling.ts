import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every `intervalMs` while `active` is true. The callback is
 * held in a ref, so an inline closure does not restart the interval on every
 * render. Used by the EC2 pages to auto-refresh while a resource is still
 * settling (pending / stopping / shutting-down).
 */
export function usePolling(active: boolean, intervalMs: number, callback: () => void): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      callbackRef.current();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [active, intervalMs]);
}
