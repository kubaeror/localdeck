import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ApiErrorResponse, ServiceOperationResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const LIST_BUCKETS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>localdeck-test</ID><DisplayName>localdeck</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>alpha-bucket</Name><CreationDate>2026-01-02T03:04:05.000Z</CreationDate></Bucket>
    <Bucket><Name>beta-bucket</Name><CreationDate>2026-02-03T04:05:06.000Z</CreationDate></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`;

interface RecordedRequest {
  method: string;
  url: string;
}

interface StubLocalStack {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

/**
 * A minimal S3-shaped stub. Recording request lines lets the tests prove the
 * dispatcher used path-style addressing (bucket in the path, not the host).
 */
async function startStubLocalStack(): Promise<StubLocalStack> {
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((request, response) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '' });

    if (request.method === 'GET' && (request.url === '/' || request.url?.startsWith('/?'))) {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(LIST_BUCKETS_XML);
      return;
    }

    // GetObject: raw bytes, which the SDK exposes as a Node stream.
    if (request.method === 'GET' && request.url?.startsWith('/binary-bucket/')) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.from('object bytes'));
      return;
    }

    if (request.method === 'PUT' && request.url !== undefined && request.url !== '/') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end('');
      return;
    }

    if (request.method === 'DELETE') {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, { 'content-type': 'application/xml' });
    response.end('<Error><Code>NoSuchKey</Code><Message>stub</Message></Error>');
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
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

describe('service operation dispatcher', () => {
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

  it('proxies a whitelisted operation through the SDK client factory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/s3/ListBuckets',
      payload: { input: {} },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceOperationResponse>();
    expect(body.service).toBe('s3');
    expect(body.operation).toBe('ListBuckets');
    expect(body.result).toMatchObject({
      Owner: { ID: 'localdeck-test' },
      Buckets: [{ Name: 'alpha-bucket' }, { Name: 'beta-bucket' }],
    });
  });

  it('does not abort a dispatcher call that carries a request body over real HTTP', async () => {
    // Regression: Fastify's request.signal aborts when the request stream
    // closes, which for a POST happens right after the body is parsed. Using
    // it as the SDK abort signal made every body-carrying call answer 408.
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/services/s3/ListBuckets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ServiceOperationResponse;
    expect(body.operation).toBe('ListBuckets');
  });

  it('uses path-style addressing for S3', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/s3/CreateBucket',
      payload: { input: { Bucket: 'localdeck-path-style-test' } },
    });

    expect(response.statusCode).toBe(200);
    // The SDK appends a trailing slash to bucket-level PUTs; the bucket is in
    // the path either way, which is what path-style addressing means.
    const created = stub.requests.filter(
      (request) =>
        request.method === 'PUT' && request.url.replace(/\/$/, '') === '/localdeck-path-style-test',
    );
    expect(created).toHaveLength(1);
    // No request ever addressed the bucket through the host name.
    expect(
      stub.requests.some((request) => request.url.includes('localdeck-path-style-test.')),
    ).toBe(false);
  });

  it('rejects operations that are not on the whitelist with 400', async () => {
    const requestsBefore = stub.requests.length;
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/s3/DeleteEverything',
      payload: { input: {} },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('OPERATION_NOT_WHITELISTED');
    expect(body.error.statusCode).toBe(400);
    expect(body.error.service).toBe('s3');
    expect(body.error.details?.['operation']).toBe('DeleteEverything');
    expect(body.error.details?.['allowedOperations']).toContain('ListBuckets');
    // The rejection happens before the SDK is touched.
    expect(stub.requests).toHaveLength(requestsBefore);
  });

  it('rejects non-whitelisted operations of other services with 400 as well', async () => {
    // RunInstances is whitelisted; DetachVolume is deliberately not, because
    // this LocalStack build answers it with an internal error.
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/ec2/DetachVolume',
      payload: { input: {} },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('OPERATION_NOT_WHITELISTED');
    expect(body.error.details?.['operation']).toBe('DetachVolume');
    expect(body.error.details?.['allowedOperations']).toContain('RunInstances');
  });

  it('rejects unknown services with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/not-a-service/ListThings',
      payload: { input: {} },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('SERVICE_NOT_REGISTERED');
    expect(body.error.details?.['serviceId']).toBe('not-a-service');
  });

  it('explains services whose SDK package is not installed yet', async () => {
    // batch's SDK package is deliberately not a dependency of the api.
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/batch/DescribeJobQueues',
      payload: { input: {} },
    });

    expect(response.statusCode).toBe(501);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('SDK_PACKAGE_UNAVAILABLE');
    expect(body.error.message).toContain('@aws-sdk/client-batch');
    expect(body.error.message).toContain('pnpm --filter @localdeck/api add');
    expect(body.error.details?.['sdkPackage']).toBe('@aws-sdk/client-batch');
  });

  it('validates the request shape', async () => {
    const badOperation = await app.inject({
      method: 'POST',
      url: '/api/services/s3/not-an-operation!',
      payload: { input: {} },
    });
    expect(badOperation.statusCode).toBe(400);
    expect(badOperation.json<ApiErrorResponse>().error.code).toBe('VALIDATION_FAILED');

    // Unknown body properties are rejected, never silently dropped.
    const badBody = await app.inject({
      method: 'POST',
      url: '/api/services/s3/ListBuckets',
      payload: { unexpected: true },
    });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json<ApiErrorResponse>().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(badBody.json<ApiErrorResponse>().error.details)).toContain(
      'additionalProperties',
    );

    const badInput = await app.inject({
      method: 'POST',
      url: '/api/services/s3/ListBuckets',
      payload: { input: 'not-an-object' },
    });
    expect(badInput.statusCode).toBe(400);
  });

  it('accepts requests without a body', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/services/s3/ListBuckets' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ServiceOperationResponse>().operation).toBe('ListBuckets');
  });

  it('rejects stream-producing operations with a clean 501 (API-001)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/s3/GetObject',
      payload: { input: { Bucket: 'binary-bucket', Key: 'file.bin' } },
    });

    expect(response.statusCode).toBe(501);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('BINARY_RESPONSE_UNSUPPORTED');
    expect(body.error.message).toContain('dedicated S3 object routes');
  });

  it('maps SDK serializer TypeErrors to 400 VALIDATION_FAILED (LD-09)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/lambda/Invoke',
      payload: { input: { FunctionName: 'demo', Payload: 5 } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.['reason']).toBe('sdk-input-serialization');
  });
});
