// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBucket,
  deleteBuckets,
  deleteFolder,
  downloadObjectUrl,
  getBucketPolicy,
  getBucketTags,
  getPublicAccessBlock,
  listObjects,
  uploadObject,
} from './api';

type Handler = (input: Record<string, unknown>) => unknown;

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

/** Answers the api dispatcher as the Fastify route would, recording calls. */
function stubDispatcher(handler: Handler): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/s3\/([^/?]+)/.exec(url);
    if (match === null) {
      return new Response('{}', { status: 404 });
    }
    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });

    const result = handler(operationInput);
    // The handler throws an ApiClientError-shaped payload for failures.
    if (typeof result === 'object' && result !== null && '__error' in result) {
      const error = (result as { __error: { code: string; message: string; statusCode: number } })
        .__error;
      return new Response(JSON.stringify({ error }), {
        status: error.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service: 's3', operation, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function operationInput(calls: readonly Call[], operation: string): Record<string, unknown> {
  const call = calls.find((entry) => entry.operation === operation);
  if (call === undefined) throw new Error(`${operation} was not called`);
  return call.input;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listObjects', () => {
  it('maps common prefixes to folders and keys to objects', async () => {
    const calls = stubDispatcher(() => ({
      CommonPrefixes: [{ Prefix: 'photos/2025/' }, { Prefix: 'photos/2026/' }],
      Contents: [
        { Key: 'photos/', Size: 0, LastModified: '2026-01-01T00:00:00.000Z' },
        {
          Key: 'photos/cat.jpg',
          Size: 2048,
          LastModified: '2026-02-01T00:00:00.000Z',
          StorageClass: 'STANDARD',
          ETag: '"abc"',
        },
      ],
      NextContinuationToken: 'page-2',
    }));

    const page = await listObjects({ bucket: 'my-bucket', prefix: 'photos/' });

    expect(operationInput(calls, 'ListObjectsV2')).toMatchObject({
      Bucket: 'my-bucket',
      Prefix: 'photos/',
      Delimiter: '/',
    });
    expect(page.folders.map((folder) => folder.name)).toEqual(['2025/', '2026/']);
    expect(page.objects).toHaveLength(1);
    expect(page.objects[0]).toMatchObject({
      kind: 'object',
      key: 'photos/cat.jpg',
      name: 'cat.jpg',
      size: 2048,
      storageClass: 'STANDARD',
    });
    expect(page.nextToken).toBe('page-2');
  });

  it('walks every key without the delimiter when recursive', async () => {
    const calls = stubDispatcher(() => ({ Contents: [{ Key: 'a/b/c.txt', Size: 1 }] }));
    await listObjects({ bucket: 'my-bucket', prefix: 'a/', recursive: true });
    expect(operationInput(calls, 'ListObjectsV2')).not.toHaveProperty('Delimiter');
  });
});

describe('optional reads', () => {
  it('returns an empty tag list for NoSuchTagSet', async () => {
    stubDispatcher(() => ({
      __error: { code: 'NoSuchTagSet', message: 'The TagSet does not exist', statusCode: 404 },
    }));
    await expect(getBucketTags('b')).resolves.toEqual([]);
  });

  it('returns undefined for NoSuchBucketPolicy', async () => {
    stubDispatcher(() => ({
      __error: {
        code: 'NoSuchBucketPolicy',
        message: 'The bucket policy does not exist',
        statusCode: 404,
      },
    }));
    await expect(getBucketPolicy('b')).resolves.toBeUndefined();
  });

  it('returns unconfigured public access for NoSuchPublicAccessBlockConfiguration', async () => {
    stubDispatcher(() => ({
      __error: {
        code: 'NoSuchPublicAccessBlockConfiguration',
        message: 'not found',
        statusCode: 404,
      },
    }));

    await expect(getPublicAccessBlock('b')).resolves.toEqual({
      BlockPublicAcls: false,
      IgnorePublicAcls: false,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false,
      configured: false,
    });
  });

  it('propagates other failures instead of hiding them', async () => {
    stubDispatcher(() => ({
      __error: { code: 'AccessDenied', message: 'no', statusCode: 403 },
    }));
    await expect(getBucketTags('b')).rejects.toMatchObject({ apiError: { code: 'AccessDenied' } });
  });
});

describe('createBucket', () => {
  it('creates the bucket and applies the requested settings in order', async () => {
    const calls = stubDispatcher(() => ({}));
    await createBucket({
      name: 'my-bucket',
      region: 'eu-west-1',
      versioning: true,
      tags: [{ Key: 'env', Value: 'local' }],
      blockPublicAccess: true,
    });

    expect(calls.map((call) => call.operation)).toEqual([
      'CreateBucket',
      'PutBucketVersioning',
      'PutBucketTagging',
      'PutPublicAccessBlock',
    ]);
    expect(operationInput(calls, 'CreateBucket')).toEqual({
      Bucket: 'my-bucket',
      CreateBucketConfiguration: { LocationConstraint: 'eu-west-1' },
    });
    expect(operationInput(calls, 'PutPublicAccessBlock')).toMatchObject({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('omits the location constraint in us-east-1 and skips optional steps', async () => {
    const calls = stubDispatcher(() => ({}));
    await createBucket({
      name: 'my-bucket',
      region: 'us-east-1',
      versioning: false,
      tags: [],
      blockPublicAccess: false,
    });

    expect(operationInput(calls, 'CreateBucket')).toEqual({ Bucket: 'my-bucket' });
    expect(calls.map((call) => call.operation)).toEqual(['CreateBucket', 'PutPublicAccessBlock']);
    expect(operationInput(calls, 'PutPublicAccessBlock')).toMatchObject({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    });
  });

  it('names the step that failed after the bucket already exists', async () => {
    stubDispatcher((input) =>
      'Tagging' in input
        ? { __error: { code: 'AccessDenied', message: 'no tagging', statusCode: 403 } }
        : {},
    );

    await expect(
      createBucket({
        name: 'my-bucket',
        region: 'us-east-1',
        versioning: false,
        tags: [{ Key: 'a', Value: 'b' }],
        blockPublicAccess: true,
      }),
    ).rejects.toMatchObject({
      apiError: { message: expect.stringContaining('was created, but tagging failed') },
    });
  });
});

describe('deleteBuckets', () => {
  it('reports partial failures instead of stopping', async () => {
    stubDispatcher((input) =>
      input['Bucket'] === 'locked-bucket'
        ? { __error: { code: 'BucketNotEmpty', message: 'not empty', statusCode: 409 } }
        : {},
    );

    const result = await deleteBuckets(['one', 'locked-bucket', 'two']);
    expect(result.deleted).toEqual(['one', 'two']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.bucket).toBe('locked-bucket');
    expect(result.failures[0]?.error.message).toContain('not empty');
  });
});

describe('deleteFolder', () => {
  it('walks the prefix recursively and deletes in one batch', async () => {
    const calls = stubDispatcher((input) => {
      if ('Delete' in input) return { Deleted: [{ Key: 'a/one.txt' }, { Key: 'a/two.txt' }] };
      return {
        Contents: [
          { Key: 'a/one.txt', Size: 1 },
          { Key: 'a/two.txt', Size: 2 },
        ],
      };
    });

    const result = await deleteFolder({ bucket: 'my-bucket', prefix: 'a/' });

    expect(operationInput(calls, 'ListObjectsV2')).not.toHaveProperty('Delimiter');
    expect(operationInput(calls, 'DeleteObjects')).toMatchObject({
      Delete: { Objects: [{ Key: 'a/one.txt' }, { Key: 'a/two.txt' }] },
    });
    expect(result.deleted).toHaveLength(2);
  });
});

describe('upload and download', () => {
  it('POSTs the file to the upload proxy and unwraps the result', async () => {
    const fetchMock = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({ upload: { bucket: 'b', key: 'k', size: 3, multipart: false } }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['abc'], 'hello.txt', { type: 'text/plain' });
    const result = await uploadObject({ bucket: 'b', key: 'folder/hello.txt', file });

    expect(result).toMatchObject({ key: 'k', size: 3 });
    const [call] = fetchMock.mock.calls;
    if (call === undefined) throw new Error('fetch was not called');
    const [url, init] = call;
    expect(url).toBe('/api/services/s3/objects/upload?bucket=b&key=folder%2Fhello.txt');
    expect(init?.method).toBe('POST');
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    if (!(body instanceof FormData)) throw new Error('upload body is not FormData');
    const part = body.get('file');
    expect(part).toBeInstanceOf(File);
    if (!(part instanceof File)) throw new Error('the file part is missing');
    expect(part.name).toBe('hello.txt');
    expect(part.size).toBe(3);
  });

  it('builds a same-origin download url for the proxy route', () => {
    expect(downloadObjectUrl({ bucket: 'b', key: 'a/b c.txt' })).toBe(
      '/api/services/s3/objects/download?bucket=b&key=a%2Fb%20c.txt',
    );
  });
});
