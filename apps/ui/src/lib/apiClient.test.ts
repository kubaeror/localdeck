import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorResponse, HealthResponse } from '@localdeck/shared';
import { ApiClientError, getHealth, getText, toApiError } from './apiClient';

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
      provider: {
        provider: 'localstack',
        providerLabel: 'LocalStack',
        version: '2026.8.2',
        edition: 'pro',
        docsUrl: 'https://docs.localstack.cloud/aws/services/',
      },
      emulator: {
        provider: 'localstack',
        providerLabel: 'LocalStack',
        version: '2026.8.2',
        edition: 'pro',
        hasServiceInventory: true,
        services: { s3: 'enabled' },
        rawServices: { s3: 'enabled' },
        features: {},
        counts: { total: 1, enabled: 1, disabled: 0, error: 0, other: 0 },
        ready: null,
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

  it('maps the Floci contract unavailable payload onto the unreachable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          status: 'unavailable',
          endpoint: 'http://localhost:4566',
          error: 'MiniStack is unreachable at http://localhost:4566.',
          console: { name: 'LocalDeck', version: '0.1.0' },
        }),
      ),
    );

    await expect(getHealth()).rejects.toMatchObject({
      apiError: { code: 'EMULATOR_UNREACHABLE', statusCode: 503 },
    });
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

describe('Content-Disposition file names', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubDownload(contentDisposition: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('file body', {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': contentDisposition,
          },
        }),
      ),
    );
  }

  it('decodes an RFC 5987 filename* parameter', async () => {
    stubDownload(`attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.txt`);

    await expect(getText('/api/files/1')).resolves.toEqual({
      text: 'file body',
      fileName: 'résumé.txt',
    });
  });

  it('prefers filename* over a plain filename fallback', async () => {
    stubDownload(`attachment; filename="fallback.txt"; filename*=UTF-8''na%C3%AFve.txt`);

    await expect(getText('/api/files/1')).resolves.toEqual({
      text: 'file body',
      fileName: 'naïve.txt',
    });
  });

  it('falls back to filename when filename* is malformed', async () => {
    stubDownload(`attachment; filename="fallback.txt"; filename*=UTF-8''%E0%A4%A`);

    await expect(getText('/api/files/1')).resolves.toEqual({
      text: 'file body',
      fileName: 'fallback.txt',
    });
  });

  it('still reads quoted and bare filename parameters', async () => {
    stubDownload('attachment; filename="report.csv"');
    await expect(getText('/api/files/1')).resolves.toEqual({
      text: 'file body',
      fileName: 'report.csv',
    });

    stubDownload('attachment; filename=plain.txt');
    await expect(getText('/api/files/1')).resolves.toEqual({
      text: 'file body',
      fileName: 'plain.txt',
    });
  });
});
