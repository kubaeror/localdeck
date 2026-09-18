import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorResponse, HealthResponse } from '@localdeck/shared';
import { ApiClientError, getHealth, toApiError } from './apiClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed health payload', async () => {
    const payload: HealthResponse = {
      status: 'ok',
      checkedAt: '2026-01-01T00:00:00.000Z',
      latencyMs: 12,
      endpoint: 'http://localhost:4566',
      region: 'us-east-1',
      localstack: {
        version: '2026.8.2',
        edition: 'pro',
        services: { s3: 'available' },
        features: {},
        counts: { total: 1, available: 1, error: 0, other: 0 },
      },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getHealth()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('surfaces the shared ApiError from a 503 response', async () => {
    const body: ApiErrorResponse = {
      error: {
        code: 'LOCALSTACK_UNREACHABLE',
        message: 'LocalDeck api is running, but LocalStack is unreachable.',
        statusCode: 503,
        details: { endpoint: 'http://localhost:4566' },
      },
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, 503)));

    const error = await getHealth().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).apiError.code).toBe('LOCALSTACK_UNREACHABLE');
    expect((error as ApiClientError).apiError.statusCode).toBe(503);
  });

  it('synthesizes an ApiError when the failure body is not an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    );

    const error = (await getHealth().catch((caught: unknown) => caught)) as ApiClientError;
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.apiError.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.apiError.statusCode).toBe(502);
  });

  it('reports a network failure when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));

    const error = (await getHealth().catch((caught: unknown) => caught)) as ApiClientError;
    expect(error.apiError.code).toBe('NETWORK_ERROR');
    expect(error.apiError.statusCode).toBe(0);
  });

  it('reports a malformed success body as UNEXPECTED_RESPONSE, not NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy</html>', { status: 200 })),
    );

    const error = (await getHealth().catch((caught: unknown) => caught)) as ApiClientError;
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.apiError.code).toBe('UNEXPECTED_RESPONSE');
    expect(error.apiError.statusCode).toBe(200);
  });

  it('passes an ApiError through toApiError unchanged', () => {
    const apiError = { code: 'X', message: 'm', statusCode: 418 };
    expect(toApiError(new ApiClientError(apiError))).toEqual(apiError);
  });
});
