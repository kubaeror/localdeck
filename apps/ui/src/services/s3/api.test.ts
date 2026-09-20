// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyObject,
  createBucket,
  deleteBuckets,
  deleteFolder,
  deleteObjects,
  deletePublicAccessBlock,
  downloadObjectUrl,
  getBucketEncryption,
  getBucketPolicy,
  getBucketTags,
  getPublicAccessBlock,
  listObjects,
  moveObject,
  triggerDownload,
  uploadObject,
} from './api';
import { toFriendlyS3Error } from './errors';

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

  it('treats an empty encryption Rules list as the SSE-S3 default', async () => {
    stubDispatcher(() => ({ ServerSideEncryptionConfiguration: { Rules: [] } }));
    await expect(getBucketEncryption('b')).resolves.toEqual({ configured: false });
  });

  it('reports an explicit encryption rule', async () => {
    stubDispatcher(() => ({
      ServerSideEncryptionConfiguration: {
        Rules: [
          {
            ApplyServerSideEncryptionByDefault: {
              SSEAlgorithm: 'aws:kms',
              KMSMasterKeyID: 'key-1',
            },
            BucketKeyEnabled: true,
          },
        ],
      },
    }));
    await expect(getBucketEncryption('b')).resolves.toEqual({
      configured: true,
      algorithm: 'aws:kms',
      kmsKeyArn: 'key-1',
      bucketKeyEnabled: true,
    });
  });

  it('calls DeletePublicAccessBlock with the bucket', async () => {
    const calls = stubDispatcher(() => ({}));
    await deletePublicAccessBlock('my-bucket');
    expect(calls).toEqual([
      { operation: 'DeletePublicAccessBlock', input: { Bucket: 'my-bucket' } },
    ]);
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

    const caught = await createBucket({
      name: 'my-bucket',
      region: 'us-east-1',
      versioning: false,
      tags: [{ Key: 'a', Value: 'b' }],
      blockPublicAccess: true,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    // The user-facing wording is what matters: the annotation survives the
    // friendly-code mapping instead of being replaced by generic AccessDenied.
    const friendly = toFriendlyS3Error(caught);
    expect(friendly.message).toContain('was created, but tagging failed');
    expect(friendly.message).toContain('LocalStack denied this action');
    expect(friendly.field).toBeNull();
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
  it('includes the prefix marker and nested markers, not just leaf objects', async () => {
    const calls = stubDispatcher((input) => {
      if ('Delete' in input) {
        const objects = (input['Delete'] as { Objects: { Key: string }[] }).Objects;
        return { Deleted: objects };
      }
      return {
        Contents: [
          { Key: 'a/', Size: 0 },
          { Key: 'a/nested/', Size: 0 },
          { Key: 'a/nested/one.txt', Size: 1 },
          { Key: 'a/two.txt', Size: 2 },
        ],
      };
    });

    const result = await deleteFolder({ bucket: 'my-bucket', prefix: 'a/' });

    expect(operationInput(calls, 'ListObjectsV2')).toEqual({ Bucket: 'my-bucket', Prefix: 'a/' });
    const keys = (
      operationInput(calls, 'DeleteObjects')['Delete'] as { Objects: { Key: string }[] }
    ).Objects.map((entry) => entry.Key);
    expect(keys).toEqual(
      expect.arrayContaining(['a/', 'a/nested/', 'a/nested/one.txt', 'a/two.txt']),
    );
    expect(result.deleted).toHaveLength(4);
    expect(result.failures).toEqual([]);
  });

  it('deletes the marker of an otherwise empty folder', async () => {
    const calls = stubDispatcher((input) => {
      if ('Delete' in input) return { Deleted: [{ Key: 'empty/' }] };
      return { Contents: [{ Key: 'empty/', Size: 0 }] };
    });

    const result = await deleteFolder({ bucket: 'my-bucket', prefix: 'empty/' });

    const keys = (
      operationInput(calls, 'DeleteObjects')['Delete'] as { Objects: { Key: string }[] }
    ).Objects.map((entry) => entry.Key);
    expect(keys).toEqual(['empty/']);
    expect(result.deleted).toEqual(['empty/']);
  });

  it('deletes each listing page as it arrives, without buffering every key', async () => {
    const firstPage = Array.from({ length: 1000 }, (_value, index) => ({
      Key: `a/object-${String(index).padStart(4, '0')}.txt`,
      Size: 1,
    }));
    const calls = stubDispatcher((input) => {
      if ('Delete' in input) {
        const objects = (input['Delete'] as { Objects: { Key: string }[] }).Objects;
        return { Deleted: objects };
      }
      if (input['ContinuationToken'] === 'page-2') {
        return { Contents: [{ Key: 'a/last.txt', Size: 1 }] };
      }
      return { Contents: firstPage, NextContinuationToken: 'page-2' };
    });

    const result = await deleteFolder({ bucket: 'my-bucket', prefix: 'a/' });

    const listings = calls.filter((call) => call.operation === 'ListObjectsV2');
    expect(listings).toHaveLength(2);
    expect(listings[1]?.input).toMatchObject({ ContinuationToken: 'page-2' });
    const deleteBatches = calls.filter((call) => call.operation === 'DeleteObjects');
    // 1000 objects + the explicit prefix marker → two batches, then page two.
    expect(deleteBatches).toHaveLength(3);
    expect(result.deleted).toHaveLength(1002);
    expect(result.failures).toEqual([]);
  });

  it('refuses an empty or bucket-root prefix instead of deleting the whole bucket', async () => {
    const calls = stubDispatcher(() => ({ Contents: [{ Key: 'a.txt', Size: 1 }] }));

    await expect(deleteFolder({ bucket: 'my-bucket', prefix: '' })).rejects.toThrow(
      /Refusing to delete/,
    );
    await expect(deleteFolder({ bucket: 'my-bucket', prefix: '/' })).rejects.toThrow(
      /Refusing to delete/,
    );
    // The guard runs before any listing or delete reaches the api.
    expect(calls).toEqual([]);
  });
});

describe('deleteObjects', () => {
  it('keeps per-batch failures and continues with the remaining batches', async () => {
    const calls = stubDispatcher((input) => {
      const objects = (input['Delete'] as { Objects: { Key: string }[] }).Objects;
      if (objects[0]?.Key === 'batch-0.txt') {
        return { __error: { code: 'AccessDenied', message: 'batch denied', statusCode: 403 } };
      }
      return { Deleted: objects };
    });
    const keys = [
      ...Array.from({ length: 1000 }, () => 'batch-0.txt'),
      'batch-1.txt',
      'batch-2.txt',
    ];

    const result = await deleteObjects({ bucket: 'my-bucket', keys });

    expect(calls.filter((call) => call.operation === 'DeleteObjects')).toHaveLength(2);
    expect(result.deleted).toEqual(['batch-1.txt', 'batch-2.txt']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.key).toContain('1000 objects');
    expect(result.failures[0]?.message).toContain('denied this action');
  });

  it('reports per-key errors AWS answered inside a batch', async () => {
    stubDispatcher(() => ({
      Deleted: [{ Key: 'ok.txt' }],
      Errors: [{ Key: 'locked.txt', Code: 'AccessDenied', Message: 'no' }],
    }));

    const result = await deleteObjects({ bucket: 'my-bucket', keys: ['ok.txt', 'locked.txt'] });
    expect(result.deleted).toEqual(['ok.txt']);
    expect(result.failures).toEqual([{ key: 'locked.txt', code: 'AccessDenied', message: 'no' }]);
  });
});

describe('copyObject source encoding', () => {
  it('percent-encodes every key segment but keeps the slashes', async () => {
    const calls = stubDispatcher(() => ({}));
    await copyObject({
      sourceBucket: 'source-bucket',
      sourceKey: 'dir/a b/%?#&é/ф.txt',
      destinationBucket: 'dest-bucket',
      destinationKey: 'copy.txt',
    });

    expect(operationInput(calls, 'CopyObject')).toMatchObject({
      CopySource: '/source-bucket/dir/a%20b/%25%3F%23%26%C3%A9/%D1%84.txt',
    });
  });
});

describe('moveObject', () => {
  it('says the copy completed when deleting the source fails', async () => {
    const calls = stubDispatcher((input) =>
      'CopySource' in input
        ? {}
        : { __error: { code: 'AccessDenied', message: 'no delete', statusCode: 403 } },
    );

    const caught = await moveObject({
      sourceBucket: 'source-bucket',
      sourceKey: 'docs/move.txt',
      destinationBucket: 'dest-bucket',
      destinationKey: 'moved.txt',
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(calls.map((call) => call.operation)).toEqual(['CopyObject', 'DeleteObject']);
    const friendly = toFriendlyS3Error(caught);
    expect(friendly.message).toContain('Object "moved.txt" was copied');
    expect(friendly.message).toContain('deleting the source object failed');
    // The canned per-code wording is appended, not substituted for the story.
    expect(friendly.message).toContain('LocalStack denied this action');
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

  it('opens the download in a new tab so a failure cannot replace the console', () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal('open', open);

    triggerDownload('/api/services/s3/objects/download?bucket=b&key=a.txt');

    expect(open).toHaveBeenCalledWith(
      '/api/services/s3/objects/download?bucket=b&key=a.txt',
      '_blank',
      'noopener',
    );
  });
});
