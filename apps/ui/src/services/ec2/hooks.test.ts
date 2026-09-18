// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEc2Resource } from './hooks';

describe('useEc2Resource', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the last data and sets the error when a silent reload fails', async () => {
    let fail = false;
    const loader = async (): Promise<string> => {
      if (fail) throw new Error('transient network failure');
      return 'loaded';
    };
    const { result } = renderHook(() => useEc2Resource(loader));

    await waitFor(() => {
      expect(result.current.data).toBe('loaded');
    });

    fail = true;
    await act(async () => {
      await result.current.reload({ silent: true });
    });

    expect(result.current.data).toBe('loaded');
    expect(result.current.error).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears the data when the initial load fails', async () => {
    const loader = async (): Promise<string> => {
      throw new Error('down');
    };
    const { result } = renderHook(() => useEc2Resource(loader));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears the data when an explicit (non-silent) reload fails', async () => {
    let fail = false;
    const loader = async (): Promise<string> => {
      if (fail) throw new Error('down');
      return 'loaded';
    };
    const { result } = renderHook(() => useEc2Resource(loader));

    await waitFor(() => {
      expect(result.current.data).toBe('loaded');
    });

    fail = true;
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
});
