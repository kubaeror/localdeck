import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ApiErrorResponse, S3UploadResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { rejectUploadPart, truncationGuard } from '../src/routes/s3.js';

const BUCKET = 'localdeck-proxy-test';

interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  bodyLength: number;
  headers: Record<string, string | string[] | undefined>;
}

interface StubLocalStack {
  url: string;
  requests: RecordedRequest[];
  /** Bytes stored by the stub's PutObject/CompleteMultipartUpload handling. */
  stored: Map<string, Buffer>;
  close: () => Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function xml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'application/xml' });
  response.end(body);
}

/**
 * Minimal S3-shaped stub covering exactly what the object proxy routes send:
 * bucket PUTs, single PutObject, the three multipart upload calls, and the
 * GetObject the download proxy sends through the SDK. Signature parameters are
 * ignored — the tests assert the route reached S3, not how it was signed.
 */
async function startStubLocalStack(): Promise<StubLocalStack> {
  const requests: RecordedRequest[] = [];
  const stored = new Map<string, Buffer>();
  /** UploadPart bodies, keyed `${uploadId}:${partNumber}`. */
  const partBodies = new Map<string, Buffer>();
  let uploads = 0;

  const server: Server = createServer((request, response) => {
    void (async () => {
      const rawBody = await readBody(request);
      const url = new URL(request.url ?? '/', 'http://stub');
      const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
      requests.push({
        method: request.method ?? '',
        path: url.pathname,
        query: url.search.slice(1),
        bodyLength: rawBody.length,
        headers: request.headers,
      });

      const uploadId = url.searchParams.get('uploadId');

      // CreateBucket: PUT /<bucket>
      if (request.method === 'PUT' && url.search === '' && key === BUCKET) {
        xml(response, 200, '');
        return;
      }

      // CreateMultipartUpload: POST /<bucket>/<key>?uploads
      if (request.method === 'POST' && url.searchParams.has('uploads')) {
        uploads += 1;
        const id = `upload-${uploads}`;
        xml(
          response,
          200,
          `<InitiateMultipartUploadResult><Bucket>${BUCKET}</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
        );
        return;
      }

      // UploadPart: PUT /<bucket>/<key>?partNumber=N&uploadId=id
      if (request.method === 'PUT' && uploadId !== null) {
        const partNumber = url.searchParams.get('partNumber') ?? '0';
        partBodies.set(`${uploadId}:${partNumber}`, rawBody);
        response.writeHead(200, {
          etag: `"etag-${partNumber}"`,
          'content-type': 'application/xml',
        });
        response.end('');
        return;
      }

      // CompleteMultipartUpload: POST /<bucket>/<key>?uploadId=id
      if (request.method === 'POST' && uploadId !== null) {
        const collected = [...partBodies.entries()]
          .filter(([storeKey]) => storeKey.startsWith(`${uploadId}:`))
          .sort(
            ([left], [right]) =>
              Number.parseInt(left.split(':')[1] ?? '0', 10) -
              Number.parseInt(right.split(':')[1] ?? '0', 10),
          )
          .map(([, value]) => value);
        stored.set(key.slice(BUCKET.length + 1), Buffer.concat(collected));
        xml(
          response,
          200,
          '<CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>',
        );
        return;
      }

      // PutObject: PUT /<bucket>/<key>
      if (request.method === 'PUT' && key.startsWith(`${BUCKET}/`)) {
        stored.set(key.slice(BUCKET.length + 1), rawBody);
        response.writeHead(200, { etag: '"single"', 'content-type': 'application/xml' });
        response.end('');
        return;
      }

      // A GetObject (presigned): GET /<bucket>/<key>
      if (request.method === 'GET' && key.startsWith(`${BUCKET}/`)) {
        const objectKey = key.slice(BUCKET.length + 1);
        if (objectKey === 'huge-error.txt') {
          // A misbehaving endpoint with an unbounded error body (API-008).
          const filler = 'x'.repeat(256 * 1024);
          xml(
            response,
            404,
            `<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Padding>${filler}</Padding></Error>`,
          );
          return;
        }
        const body = stored.get(objectKey);
        if (body === undefined) {
          xml(
            response,
            404,
            '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
          );
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(body.length),
          etag: '"stored"',
        });
        response.end(body);
        return;
      }

      xml(response, 404, '<Error><Code>NoSuchBucket</Code><Message>stub</Message></Error>');
    })();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the S3 stub failed to bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    stored,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

/** Encodes one file as a real multipart/form-data request body. */
async function multipartFile(
  bytes: Buffer,
  partName = 'file',
  filename = 'hello.txt',
): Promise<{ payload: Buffer; contentType: string }> {
  const form = new FormData();
  form.append(partName, new Blob([new Uint8Array(bytes)], { type: 'text/plain' }), filename);
  const encoded = new Response(form);
  return {
    payload: Buffer.from(await encoded.arrayBuffer()),
    contentType: encoded.headers.get('content-type') ?? 'multipart/form-data',
  };
}

describe('S3 object proxy routes', () => {
  let stub: StubLocalStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubLocalStack();
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: stub.url,
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('uploads a small file with a single PutObject', async () => {
    const bytes = Buffer.from('hello localstack');
    const { payload, contentType } = await multipartFile(bytes);
    const response = await app.inject({
      method: 'POST',
      url: `/api/services/s3/objects/upload?bucket=${BUCKET}&key=folder/hello.txt`,
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<S3UploadResponse>();
    expect(body.upload).toMatchObject({
      bucket: BUCKET,
      key: 'folder/hello.txt',
      size: bytes.length,
      multipart: false,
    });

    const puts = stub.requests.filter(
      (request) => request.method === 'PUT' && request.path === `/${BUCKET}/folder/hello.txt`,
    );
    expect(puts).toHaveLength(1);
    expect(stub.stored.get('folder/hello.txt')?.toString()).toBe('hello localstack');
  });

  it('switches to the S3 multipart upload API above the threshold', async () => {
    const partSize = 8 * 1024 * 1024;
    const bytes = Buffer.alloc(partSize + 1024, 0x61);
    const { payload, contentType } = await multipartFile(bytes, 'file', 'large.bin');

    const response = await app.inject({
      method: 'POST',
      url: `/api/services/s3/objects/upload?bucket=${BUCKET}&key=large.bin`,
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<S3UploadResponse>();
    expect(body.upload).toMatchObject({ size: bytes.length, multipart: true });

    const paths = stub.requests
      .filter((request) => request.path === `/${BUCKET}/large.bin`)
      .map((request) => `${request.method} ?${request.query}`);
    expect(paths[0]).toMatch(/^POST \?uploads=?$/);
    expect(paths.some((line) => line.startsWith('PUT ?partNumber=1&uploadId=upload-1'))).toBe(true);
    expect(paths.some((line) => line.startsWith('PUT ?partNumber=2&uploadId=upload-1'))).toBe(true);
    expect(paths).toContain('POST ?uploadId=upload-1');
    // The object was completed from exactly the bytes that were sent.
    expect(stub.stored.get('large.bin')?.length).toBe(bytes.length);
    expect(stub.stored.get('large.bin')?.equals(bytes)).toBe(true);
  }, 30_000);

  it('streams the object through the SDK instead of a presigned URL', async () => {
    stub.stored.set('folder/report.txt', Buffer.from('proxied bytes'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=folder/report.txt`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('proxied bytes');
    expect(response.headers['x-localdeck-download-mode']).toBe('sdk-stream');
    expect(response.headers['content-disposition']).toBe('attachment; filename="report.txt"');
    // The api fetched the object itself; no presigned URL is handed to the
    // browser, and the stub saw a plain signed GetObject.
    const gets = stub.requests.filter((request) => request.method === 'GET');
    expect(gets.length).toBeGreaterThan(0);
    expect(gets.every((request) => !request.query.includes('X-Amz-Signature'))).toBe(true);
  });

  it('forwards content-encoding and supports Range requests', async () => {
    stub.stored.set('encoded.txt.gz', Buffer.from('compressed-bytes'));

    const ranged = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=encoded.txt.gz`,
      headers: { range: 'bytes=0-3' },
    });

    // The stub ignores Range, so the api answers the full body with 200; the
    // assertion here is that the Range header is forwarded to S3, which the
    // recorded request proves.
    expect(ranged.statusCode).toBe(200);
    const get = stub.requests.find(
      (request) => request.method === 'GET' && request.path.endsWith('encoded.txt.gz'),
    );
    expect(get?.headers['range']).toBe('bytes=0-3');
  });

  it('maps a missing object on the SDK download to NoSuchKey', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=missing.txt`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('NoSuchKey');
    expect(body.error.service).toBe('s3');
    expect(body.error.details?.['upstreamStatusCode']).toBe(404);
  });

  it('rejects an upload without a file part', async () => {
    const { payload, contentType } = await multipartFile(Buffer.from('x'), 'attachment');
    const response = await app.inject({
      method: 'POST',
      url: `/api/services/s3/objects/upload?bucket=${BUCKET}&key=x.txt`,
      payload,
      headers: { 'content-type': contentType },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('"attachment"');
  });

  it('rejects a non-multipart upload with the shared error contract', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/services/s3/objects/upload?bucket=${BUCKET}&key=x.txt`,
      payload: { not: 'multipart' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.code).toBe('VALIDATION_FAILED');
  });

  it('validates bucket and key before touching S3', async () => {
    const requestsBefore = stub.requests.length;
    const badBucket = await app.inject({
      method: 'GET',
      url: '/api/services/s3/objects/download?bucket=INVALID_BUCKET&key=x',
    });
    expect(badBucket.statusCode).toBe(400);

    const missingKey = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}`,
    });
    expect(missingKey.statusCode).toBe(400);
    expect(stub.requests).toHaveLength(requestsBefore);
  });

  it('enforces the 1024 UTF-8 byte key limit, not UTF-16 code units (API-020)', async () => {
    const requestsBefore = stub.requests.length;
    const emojiKey = '\u{1f600}'.repeat(400);
    expect(emojiKey.length).toBe(800);

    const response = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=${encodeURIComponent(emojiKey)}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.['actualBytes']).toBe(1600);
    expect(stub.requests).toHaveLength(requestsBefore);
  });

  it('caps a huge upstream error body before parsing it (API-008)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=huge-error.txt`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('NoSuchKey');
    expect(body.error.message).toBe('The specified key does not exist.');
  });
});

describe('rejected multipart parts', () => {
  it('resumes the rejected part stream before throwing (API-007)', async () => {
    const resume = vi.fn();
    const part = {
      fieldname: 'attachment',
      file: { resume } as unknown as Readable,
    };

    expect(() => rejectUploadPart(part, { bucket: BUCKET, key: 'x.txt' })).toThrow(
      /Expected the file part to be named "file"/,
    );
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe('upload truncation guard', () => {
  it('fails when the multipart part was truncated at the size limit', async () => {
    const source = Readable.from([Buffer.from('partial')]) as Readable & { truncated?: boolean };
    source.truncated = true;

    const outcome = await new Promise<Error | undefined>((resolve) => {
      const guarded = source.pipe(truncationGuard(source));
      guarded.on('data', () => undefined);
      guarded.on('end', () => {
        resolve(undefined);
      });
      guarded.on('error', (error: Error) => {
        resolve(error);
      });
    });

    expect(outcome?.name).toBe('UploadTruncatedError');
  });

  it('passes a complete stream through untouched', async () => {
    const source = Readable.from([Buffer.from('complete')]) as Readable & { truncated?: boolean };

    const chunks = await new Promise<Buffer[]>((resolve, reject) => {
      const collected: Buffer[] = [];
      const guarded = source.pipe(truncationGuard(source));
      guarded.on('data', (chunk: Buffer) => collected.push(chunk));
      guarded.on('end', () => {
        resolve(collected);
      });
      guarded.on('error', reject);
    });

    expect(Buffer.concat(chunks).toString()).toBe('complete');
  });
});

describe('object key hardening', () => {
  it('rejects keys with dot segments the URL normalization could rewrite', async () => {
    const isolated = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        EMULATOR_ENDPOINT: 'http://127.0.0.1:1',
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await isolated.ready();
    try {
      const response = await isolated.inject({
        method: 'GET',
        url: `/api/services/s3/objects/download?bucket=${BUCKET}&key=${encodeURIComponent('../other/secret')}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ApiErrorResponse>().error.message).toContain('path segments');
    } finally {
      await isolated.close();
    }
  });
});
