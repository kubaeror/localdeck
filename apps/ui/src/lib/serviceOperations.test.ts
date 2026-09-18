// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callServiceOperation,
  extractResourceRows,
  nextTokenFrom,
  toPaginated,
} from './serviceOperations';

describe('callServiceOperation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the operation input to the dispatcher and unwraps the result', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          service: 's3',
          operation: 'ListBuckets',
          result: { Buckets: [{ Name: 'alpha' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callServiceOperation<{ Buckets: { Name: string }[] }>(
      's3',
      'ListBuckets',
      {
        MaxBuckets: 5,
      },
    );

    expect(result.Buckets[0]?.Name).toBe('alpha');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/services/s3/ListBuckets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ input: { MaxBuckets: 5 } });
  });

  it('surfaces the api error contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'OPERATION_NOT_WHITELISTED',
                message: '"DeleteEverything" is not whitelisted.',
                statusCode: 400,
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(callServiceOperation('s3', 'DeleteEverything')).rejects.toMatchObject({
      apiError: { code: 'OPERATION_NOT_WHITELISTED', statusCode: 400 },
    });
  });
});

describe('extractResourceRows', () => {
  it('maps an array of objects', () => {
    const rows = extractResourceRows({
      Buckets: [{ Name: 'alpha' }, { Name: 'beta' }],
      Owner: { ID: 'o' },
    });

    expect(rows).toEqual([
      { id: 'alpha', label: 'alpha', raw: { Name: 'alpha' } },
      { id: 'beta', label: 'beta', raw: { Name: 'beta' } },
    ]);
  });

  it('maps an array of strings', () => {
    expect(extractResourceRows({ TableNames: ['users', 'orders'] })).toEqual([
      { id: 'users', label: 'users', raw: { Name: 'users' } },
      { id: 'orders', label: 'orders', raw: { Name: 'orders' } },
    ]);
  });

  it('prefers AWS identifiers over array positions', () => {
    const rows = extractResourceRows({
      Items: [{ TableName: 'orders', tableSizeBytes: 12 }, { FunctionName: 'handler' }],
    });

    expect(rows.map((row) => row.id)).toEqual(['orders', 'handler']);
  });

  it('skips metadata-only responses and empty collections', () => {
    expect(extractResourceRows({ ResponseMetadata: { httpStatusCode: 200 } })).toEqual([]);
    expect(extractResourceRows({ Buckets: [], NextToken: 'abc' })).toEqual([]);
    expect(extractResourceRows(null)).toEqual([]);
    expect(extractResourceRows('nope')).toEqual([]);
  });
});

describe('pagination helpers', () => {
  it('reads the token field whichever name the service uses', () => {
    expect(nextTokenFrom({ NextToken: 'a' })).toBe('a');
    expect(nextTokenFrom({ ContinuationToken: 'b' })).toBe('b');
    expect(nextTokenFrom({ Marker: 'c' })).toBe('c');
    expect(nextTokenFrom({})).toBeUndefined();
    expect(nextTokenFrom(undefined)).toBeUndefined();
  });

  it('packages rows into the paginated envelope', () => {
    expect(toPaginated([1, 2])).toEqual({ items: [1, 2] });
    expect(toPaginated([1], 'next')).toEqual({ items: [1], nextToken: 'next' });
    expect(toPaginated([1], undefined).nextToken).toBeUndefined();
  });
});
