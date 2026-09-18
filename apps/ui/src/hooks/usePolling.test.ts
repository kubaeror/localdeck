import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the callback on every interval while active', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(true, 1_000, callback));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('does not start while inactive and stops when deactivated', () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => usePolling(active, 1_000, callback),
      { initialProps: { active: false } },
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(callback).not.toHaveBeenCalled();

    rerender({ active: true });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('clears the interval on unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(true, 1_000, callback));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires one immediate tick when asked', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(true, 1_000, callback, { immediate: true }));

    expect(callback).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a slow asynchronous callback', async () => {
    let release: (() => void) | undefined;
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderHook(() => usePolling(true, 1_000, callback, { immediate: true }));

    expect(callback).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    // The in-flight guard held while the first call was still pending.
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
