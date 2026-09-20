import type { ApiError } from '@localdeck/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../../lib/apiClient';
import { listBuckets, type S3Bucket } from './api';

export interface UseBucketsResult {
  buckets: readonly S3Bucket[];
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

/**
 * The S3 module's single bucket-fetch path. The detail page owns the call and
 * hands the result to the Objects tab, so a bucket view makes one account-wide
 * `ListBuckets` call instead of one per tab.
 */
export function useBuckets(): UseBucketsResult {
  const [buckets, setBuckets] = useState<readonly S3Bucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    // Retry must not keep showing the previous failure while the new request
    // is in flight.
    setError(null);
    try {
      const result = await listBuckets();
      if (requestId.current !== id) return;
      setBuckets(result.items);
      setError(null);
    } catch (caught) {
      if (requestId.current !== id) return;
      setError(toApiError(caught));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial bucket list
    void reload();
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  return { buckets, loading, error, reload };
}
