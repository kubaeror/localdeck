// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBuckets } from './useBuckets';

function listResponse(buckets: readonly { Name: string }[]): Response {
  return new Response(
    JSON.stringify({ service: 's3', operation: 'ListBuckets', result: { Buckets: buckets } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'AccessDenied', message: 'denied', statusCode: 403 } }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBuckets', () => {
  it('clears the previous error as soon as a reload starts', async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pending.push(resolve);
          }),
      ),
    );

    const { result } = renderHook(() => useBuckets());
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    await act(async () => {
      pending[0]?.(errorResponse());
    });
    await waitFor(() => {
      expect(result.current.error?.code).toBe('AccessDenied');
    });

    // Retry: the stale error must not stay visible while the new call runs.
    let reloaded: Promise<void> | undefined;
    act(() => {
      reloaded = result.current.reload();
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending[1]?.(listResponse([{ Name: 'alpha-bucket' }]));
      await reloaded;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.buckets.map((bucket) => bucket.name)).toEqual(['alpha-bucket']);
    expect(result.current.loading).toBe(false);
  });
});
