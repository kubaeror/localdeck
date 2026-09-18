import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ApiErrorResponse, HealthResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  parseLocalStackHealthSnapshot,
  resetLocalStackHealthCache,
} from '../src/lib/localstackHealth.js';

const HEALTH_PAYLOAD = {
  version: '2026.8.2',
  edition: 'community',
  features: { persistence: 'disabled' },
  services: {
    s3: 'available',
    lambda: 'available',
    dynamodb: 'error',
    rds: 'disabled',
    apigateway: 'running',
  },
};

interface StubLocalStack {
  url: string;
  /** Number of health requests the stub actually received. */
  requestCount: () => number;
  close: () => Promise<void>;
}

async function startStubLocalStack(payload: unknown): Promise<StubLocalStack> {
  let requests = 0;
  const server: Server = createServer((request, response) => {
    if (request.url?.startsWith('/_localstack/health') === true) {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Stub LocalStack failed to bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

function testConfig(endpoint: string) {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOCALSTACK_ENDPOINT: endpoint,
    LOCALSTACK_TIMEOUT_MS: '2000',
    // The caching behaviour has its own suite below; the route suites need a
    // fresh probe per assertion.
    LOCALSTACK_HEALTH_CACHE_MS: '0',
    AWS_REGION: 'us-east-1',
  });
}

describe('api routes with a reachable LocalStack', () => {
  let stub: StubLocalStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubLocalStack(HEALTH_PAYLOAD);
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('serves the LocalStack service statuses on GET /api/health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.endpoint).toBe(stub.url);
    expect(body.region).toBe('us-east-1');
    expect(body.localstack.version).toBe('2026.8.2');
    expect(body.localstack.counts).toEqual({ total: 5, available: 3, error: 1, other: 1 });
    expect(body.localstack.services['s3']).toBe('available');
    expect(body.localstack.services['dynamodb']).toBe('error');
    // 'running' is a legacy LocalStack status and counts as available.
    expect(body.localstack.services['apigateway']).toBe('running');
    expect(body.status).toBe('degraded');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('serves the effective endpoint and region on GET /api/config', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      application: { name: string; version: string };
      localstack: { endpoint: string; region: string; healthPath: string };
      ui: { statusPollIntervalMs: number };
    }>();
    expect(body.application.name).toBe('LocalDeck');
    expect(body.localstack.endpoint).toBe(stub.url);
    expect(body.localstack.region).toBe('us-east-1');
    expect(body.localstack.healthPath).toBe('/_localstack/health');
    expect(body.ui.statusPollIntervalMs).toBeGreaterThanOrEqual(1000);
  });

  it('answers liveness without touching LocalStack', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('ok');
  });

  it('returns a clean ApiError for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.statusCode).toBe(404);
    expect(body.error.message).toContain('/api/does-not-exist');
  });
});

describe('api behaviour when LocalStack is unreachable', () => {
  let stub: StubLocalStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubLocalStack(HEALTH_PAYLOAD);
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
    // LocalStack "goes away" while the api keeps running.
    await stub.close();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 503 with a clean ApiError instead of crashing', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('LOCALSTACK_UNREACHABLE');
    expect(body.error.statusCode).toBe(503);
    expect(body.error.message).toContain(stub.url);
    expect(body.error.details?.['reason']).toBeDefined();
    expect(body.error.message).not.toContain('at Object.');
  });

  it('keeps serving liveness and config afterwards', async () => {
    const liveness = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(liveness.statusCode).toBe(200);

    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.statusCode).toBe(200);

    // A second probe must fail the same way (no wedged state).
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(503);
    expect(health.json<ApiErrorResponse>().error.code).toBe('LOCALSTACK_UNREACHABLE');
  });
});

describe('api behaviour with an invalid LocalStack response', () => {
  let stub: StubLocalStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubLocalStack({ unexpected: true });
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('maps a malformed health document to 502 LOCALSTACK_INVALID_RESPONSE', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(502);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('LOCALSTACK_INVALID_RESPONSE');
    expect(body.error.details?.['reason']).toContain('services');
  });
});

describe('health probe caching and single-flight', () => {
  let stub: StubLocalStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    resetLocalStackHealthCache();
    stub = await startStubLocalStack(HEALTH_PAYLOAD);
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: stub.url,
        LOCALSTACK_TIMEOUT_MS: '2000',
        LOCALSTACK_HEALTH_CACHE_MS: '5000',
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
    resetLocalStackHealthCache();
  });

  it('reuses one upstream probe for concurrent and repeated requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.inject({ method: 'GET', url: '/api/health' })),
    );
    for (const response of responses) expect(response.statusCode).toBe(200);

    const repeated = await app.inject({ method: 'GET', url: '/api/health' });
    expect(repeated.statusCode).toBe(200);
    expect(stub.requestCount()).toBe(1);
  });

  it('keys the cache by endpoint so a second app never reuses the first result', async () => {
    // A process can host more than one app (tests, verification scripts); a
    // probe for the reachable stub must not answer for an unreachable endpoint.
    const unreachable = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: 'http://127.0.0.1:9',
        LOCALSTACK_TIMEOUT_MS: '1000',
        LOCALSTACK_HEALTH_CACHE_MS: '5000',
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    try {
      const response = await unreachable.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json<ApiErrorResponse>().error.code).toBe('LOCALSTACK_UNREACHABLE');
    } finally {
      await unreachable.close();
    }
  });
});

describe('health response semantics (API-023)', () => {
  it('answers 200 + degraded when LocalStack reports no available service', async () => {
    const stub = await startStubLocalStack({
      version: '2026.8.3',
      edition: 'community',
      services: { s3: 'starting', lambda: 'disabled' },
    });
    resetLocalStackHealthCache();
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: stub.url,
        LOCALSTACK_TIMEOUT_MS: '2000',
        LOCALSTACK_HEALTH_CACHE_MS: '0',
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('degraded');
    expect(body.localstack.counts.available).toBe(0);
    expect(response.headers['x-request-id']).toBeDefined();

    await app.close();
    await stub.close();
  });
});

describe('health document parsing', () => {
  it('normalizes unknown statuses and missing optional fields', () => {
    const snapshot = parseLocalStackHealthSnapshot(
      { services: { s3: 'available', lambda: 'weird', dynamodb: 'error' }, features: 'nope' },
      'http://localhost:4566',
    );

    expect(snapshot.version).toBeNull();
    expect(snapshot.edition).toBeNull();
    expect(snapshot.features).toEqual({});
    expect(snapshot.services).toEqual({
      s3: 'available',
      lambda: 'unknown',
      dynamodb: 'error',
    });
    expect(snapshot.counts).toEqual({ total: 3, available: 1, error: 1, other: 1 });
  });

  it('rejects payloads whose services member is missing or an array', () => {
    expect(() => parseLocalStackHealthSnapshot({}, 'http://localhost:4566')).toThrow(
      /"services" property is missing/,
    );
    expect(() => parseLocalStackHealthSnapshot({ services: [] }, 'http://localhost:4566')).toThrow(
      /"services" property is missing/,
    );
    expect(() => parseLocalStackHealthSnapshot([], 'http://localhost:4566')).toThrow(
      /not a JSON object/,
    );
  });
});
