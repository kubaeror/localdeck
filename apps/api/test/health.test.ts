import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ApiErrorResponse, HealthResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  parseEmulatorHealthDocument,
  resetEmulatorHealthCache,
} from '../src/lib/emulatorHealth.js';
import { getEmulatorProvider } from '@localdeck/shared';

const LOCALSTACK_PAYLOAD = {
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

/** Floci: `running` means enabled, `available` means disabled (inverted). */
const FLOCI_PAYLOAD = {
  version: '1.2.3',
  edition: 'community',
  original_edition: 'floci-always-free',
  services: {
    s3: 'running',
    ec2: 'available',
    monitoring: 'running',
    states: 'running',
  },
};

/** MiniStack: health only lists enabled services, all as `available`. */
const MINISTACK_PAYLOAD = {
  version: '1.5.7',
  edition: 'light',
  services: { s3: 'available', sqs: 'available', elasticfilesystem: 'available' },
  ready_scripts: { status: 'completed', total: 2, completed: 2, failed: 0 },
};

interface StubEmulator {
  url: string;
  /** Number of health requests the stub actually received. */
  requestCount: () => number;
  close: () => Promise<void>;
}

interface StubOptions {
  /** Health paths that answer with `payload`; others 404. */
  healthPaths?: readonly string[];
  payload?: unknown;
  /** Answer STS GetCallerIdentity (generic endpoint with no health document). */
  sts?: boolean;
}

async function startStubEmulator(options: StubOptions = {}): Promise<StubEmulator> {
  const healthPaths = options.healthPaths ?? ['/_localstack/health'];
  const payload = options.payload ?? LOCALSTACK_PAYLOAD;
  let requests = 0;
  const server: Server = createServer((request, response) => {
    const url = request.url ?? '/';
    const path = url.split('?')[0] ?? '/';
    if (healthPaths.includes(path)) {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }
    if (options.sts === true && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'text/xml' });
      response.end(
        '<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">' +
          '<GetCallerIdentityResult><Arn>arn:aws:iam::000000000000:user/test</Arn>' +
          '<UserId>AIDAEXAMPLE</UserId><Account>000000000000</Account></GetCallerIdentityResult>' +
          '<ResponseMetadata><RequestId>00000000-0000-0000-0000-000000000000</RequestId>' +
          '</ResponseMetadata></GetCallerIdentityResponse>',
      );
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Stub emulator failed to bind a TCP port');
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

function testConfig(endpoint: string, extra: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    EMULATOR_ENDPOINT: endpoint,
    EMULATOR_TIMEOUT_MS: '2000',
    // The caching behaviour has its own suite below; the route suites need a
    // fresh probe per assertion.
    EMULATOR_HEALTH_CACHE_MS: '0',
    AWS_REGION: 'us-east-1',
    ...extra,
  });
}

describe('api routes with a reachable LocalStack', () => {
  let stub: StubEmulator;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubEmulator();
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('serves canonical service states on GET /api/health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.endpoint).toBe(stub.url);
    expect(body.region).toBe('us-east-1');
    expect(body.provider.provider).toBe('localstack');
    expect(body.provider.providerLabel).toBe('LocalStack');
    expect(body.provider.version).toBe('2026.8.2');
    expect(body.emulator.version).toBe('2026.8.2');
    expect(body.emulator.counts).toEqual({
      total: 5,
      enabled: 3,
      disabled: 1,
      error: 1,
      other: 0,
    });
    expect(body.emulator.services['s3']).toBe('enabled');
    expect(body.emulator.services['dynamodb']).toBe('error');
    expect(body.emulator.services['rds']).toBe('disabled');
    // 'running' is a legacy LocalStack status and counts as enabled.
    expect(body.emulator.services['apigateway']).toBe('enabled');
    // dynamodb reports an error, so the document is degraded but reachable.
    expect(body.status).toBe('degraded');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('serves the effective provider and endpoint on GET /api/config', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/config' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      application: { name: string; version: string };
      emulator: {
        provider: string;
        providerLabel: string;
        endpoint: string;
        publicEndpoint: string;
        region: string;
        healthPaths: string[];
      };
      ui: { statusPollIntervalMs: number };
    }>();
    expect(body.application.name).toBe('LocalDeck');
    expect(body.emulator.provider).toBe('auto');
    expect(body.emulator.providerLabel).toBe('Auto-detect');
    expect(body.emulator.endpoint).toBe(stub.url);
    expect(body.emulator.publicEndpoint).toBe(stub.url);
    expect(body.emulator.region).toBe('us-east-1');
    expect(body.emulator.healthPaths).toContain('/_localstack/health');
    expect(body.ui.statusPollIntervalMs).toBeGreaterThanOrEqual(1000);
  });

  it('answers liveness without touching the emulator', async () => {
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

describe('provider detection', () => {
  it('detects Floci and inverts its running/available vocabulary', async () => {
    const stub = await startStubEmulator({
      healthPaths: ['/_floci/health', '/_localstack/health'],
      payload: FLOCI_PAYLOAD,
    });
    const app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.provider.provider).toBe('floci');
    expect(body.provider.providerLabel).toBe('Floci');
    // `running` = enabled, `available` = DISABLED (never the LocalStack mapping).
    expect(body.emulator.services['s3']).toBe('enabled');
    expect(body.emulator.services['ec2']).toBe('disabled');
    expect(body.emulator.counts.enabled).toBe(3);
    expect(body.emulator.counts.disabled).toBe(1);
    // Provider aliases resolve onto the canonical registry ids.
    expect(body.emulator.services['cloudwatch']).toBe('enabled');
    expect(body.emulator.services['stepfunctions']).toBe('enabled');

    await app.close();
    await stub.close();
  });

  it('detects MiniStack through ready_scripts, even on the LocalStack path', async () => {
    const stub = await startStubEmulator({
      healthPaths: ['/_ministack/health', '/_localstack/health', '/health'],
      payload: MINISTACK_PAYLOAD,
    });
    const app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const body = response.json<HealthResponse>();
    expect(body.provider.provider).toBe('ministack');
    expect(body.emulator.services['s3']).toBe('enabled');
    expect(body.emulator.services['efs']).toBe('enabled');
    expect(body.emulator.ready).toEqual({
      status: 'completed',
      total: 2,
      completed: 2,
      failed: 0,
    });
    expect(body.emulator.counts.enabled).toBe(3);

    await app.close();
    await stub.close();
  });

  it('falls back to the generic endpoint mode when only STS answers', async () => {
    const stub = await startStubEmulator({ healthPaths: [], sts: true });
    const app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.provider.provider).toBe('generic');
    expect(body.emulator.hasServiceInventory).toBe(false);
    expect(body.emulator.services).toEqual({});
    expect(body.status).toBe('degraded');

    await app.close();
    await stub.close();
  });

  it('honours a pinned provider over fingerprinting', async () => {
    const stub = await startStubEmulator({
      healthPaths: ['/_floci/health'],
      payload: FLOCI_PAYLOAD,
    });
    const app = await buildApp({
      config: testConfig(stub.url, { EMULATOR_PROVIDER: 'floci' }),
      logger: false,
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.json<HealthResponse>().provider.provider).toBe('floci');

    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.json<{ emulator: { providerLabel: string } }>().emulator.providerLabel).toBe(
      'Floci',
    );

    await app.close();
    await stub.close();
  });
});

describe('api behaviour when the emulator is unreachable', () => {
  let stub: StubEmulator;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubEmulator();
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
    // The emulator "goes away" while the api keeps running.
    await stub.close();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 503 with a clean ApiError instead of crashing', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('EMULATOR_UNREACHABLE');
    expect(body.error.statusCode).toBe(503);
    expect(body.error.message).toContain(stub.url);
    expect(body.error.details?.['reason']).toBeDefined();
    expect(body.error.message).not.toContain('at Object.');
  });

  it('names a pinned provider in the unreachable copy', async () => {
    const pinned = await buildApp({
      config: testConfig(stub.url, { EMULATOR_PROVIDER: 'floci' }),
      logger: false,
    });
    await pinned.ready();
    try {
      const response = await pinned.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json<ApiErrorResponse>().error.message).toContain('Floci');
    } finally {
      await pinned.close();
    }
  });

  it('keeps serving liveness and config afterwards', async () => {
    const liveness = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(liveness.statusCode).toBe(200);

    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.statusCode).toBe(200);

    // A second probe must fail the same way (no wedged state).
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(503);
    expect(health.json<ApiErrorResponse>().error.code).toBe('EMULATOR_UNREACHABLE');
  });
});

describe('Floci Console Contract v1 mode', () => {
  it('answers 200 unavailable when the emulator is down', async () => {
    const stub = await startStubEmulator();
    const url = stub.url;
    await stub.close();

    const app = await buildApp({
      config: testConfig(url, { LOCALDECK_CONSOLE_CONTRACT: '1' }),
      logger: false,
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      endpoint: string;
      error: string;
      console: { name: string; version: string };
    }>();
    expect(body.status).toBe('unavailable');
    expect(body.endpoint).toBe(url);
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.console.name).toBe('LocalDeck');

    await app.close();
  });

  it('adds the contract fields to a reachable health document', async () => {
    const stub = await startStubEmulator();
    const app = await buildApp({
      config: testConfig(stub.url, { LOCALDECK_CONSOLE_CONTRACT: '1' }),
      logger: false,
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      error: null;
      console: { name: string };
    }>();
    expect(body.status).toBe('ok');
    expect(body.error).toBeNull();
    expect(body.console.name).toBe('LocalDeck');

    await app.close();
    await stub.close();
  });
});

describe('api behaviour with an invalid emulator response', () => {
  let stub: StubEmulator;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubEmulator({ payload: { unexpected: true } });
    app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('maps a malformed health document to 502 EMULATOR_INVALID_RESPONSE', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(502);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('EMULATOR_INVALID_RESPONSE');
    expect(body.error.details?.['reason']).toContain('services');
  });
});

describe('health probe caching and single-flight', () => {
  let stub: StubEmulator;
  let app: FastifyInstance;

  beforeAll(async () => {
    resetEmulatorHealthCache();
    stub = await startStubEmulator();
    app = await buildApp({
      config: testConfig(stub.url, { EMULATOR_HEALTH_CACHE_MS: '5000' }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
    resetEmulatorHealthCache();
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
    const unreachable = await buildApp({
      config: testConfig('http://127.0.0.1:9', { EMULATOR_HEALTH_CACHE_MS: '5000' }),
      logger: false,
    });
    try {
      const response = await unreachable.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json<ApiErrorResponse>().error.code).toBe('EMULATOR_UNREACHABLE');
    } finally {
      await unreachable.close();
    }
  });
});

describe('health response semantics (API-023)', () => {
  it('answers 200 + degraded when no service is enabled', async () => {
    const stub = await startStubEmulator({
      payload: {
        version: '2026.8.3',
        edition: 'community',
        features: {},
        services: { s3: 'starting', lambda: 'disabled' },
      },
    });
    resetEmulatorHealthCache();
    const app = await buildApp({ config: testConfig(stub.url), logger: false });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const body = response.json<HealthResponse>();
    expect(body.status).toBe('degraded');
    expect(body.emulator.counts.enabled).toBe(0);
    expect(body.emulator.counts.other).toBe(1);
    expect(body.emulator.counts.disabled).toBe(1);
    expect(response.headers['x-request-id']).toBeDefined();

    await app.close();
    await stub.close();
  });
});

describe('health document parsing', () => {
  it('normalizes unknown statuses and missing optional fields', () => {
    const snapshot = parseEmulatorHealthDocument(
      {
        services: { s3: 'available', lambda: 'weird', dynamodb: 'error' },
        features: 'nope',
      },
      getEmulatorProvider('localstack'),
      'http://localhost:4566',
    );

    expect(snapshot.version).toBeNull();
    expect(snapshot.edition).toBeNull();
    expect(snapshot.features).toEqual({});
    expect(snapshot.services).toEqual({
      s3: 'enabled',
      lambda: 'unknown',
      dynamodb: 'error',
    });
    expect(snapshot.counts).toEqual({
      total: 3,
      enabled: 1,
      disabled: 0,
      error: 1,
      other: 1,
    });
  });

  it('rejects payloads whose services member is missing or an array', () => {
    const provider = getEmulatorProvider('localstack');
    expect(() => parseEmulatorHealthDocument({}, provider, 'http://localhost:4566')).toThrow(
      /"services" property is missing/,
    );
    expect(() =>
      parseEmulatorHealthDocument({ services: [] }, provider, 'http://localhost:4566'),
    ).toThrow(/"services" property is missing/);
    expect(() => parseEmulatorHealthDocument([], provider, 'http://localhost:4566')).toThrow(
      /not a JSON object/,
    );
  });

  it('never maps Floci "available" to enabled', () => {
    const snapshot = parseEmulatorHealthDocument(
      { services: { s3: 'available', ec2: 'running' } },
      getEmulatorProvider('floci'),
      'http://localhost:4566',
    );
    expect(snapshot.services['s3']).toBe('disabled');
    expect(snapshot.services['ec2']).toBe('enabled');
  });
});
