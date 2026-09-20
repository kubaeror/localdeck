import type { ApiErrorResponse, ServiceRegistryResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * Route-level tests for the api rate limiter. The limiter is the only thing
 * between an unauthenticated localhost proxy and a runaway browser loop, so
 * the tests pin both the shared error contract and the static-path bypass.
 */

let app: FastifyInstance | undefined;

async function buildLimitedApp(overrides: Record<string, string>): Promise<FastifyInstance> {
  const built = await buildApp({
    config: loadConfig({ ...process.env, NODE_ENV: 'test', ...overrides }),
    logger: false,
  });
  await built.ready();
  return built;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('api rate limiting', () => {
  it('answers 429 RATE_LIMITED with the shared error contract', async () => {
    app = await buildLimitedApp({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });

    const first = await app.inject({ method: 'GET', url: '/api/services' });
    const second = await app.inject({ method: 'GET', url: '/api/services' });
    const third = await app.inject({ method: 'GET', url: '/api/services' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);

    const body = third.json<ApiErrorResponse>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.statusCode).toBe(429);
    expect(body.error.details?.['max']).toBe(2);
    expect(body.error.message).toContain('RATE_LIMIT_MAX');

    // Clients can see when to retry, and CORS exposes the budget headers.
    expect(third.headers['retry-after']).toBeDefined();
    expect(third.headers['x-ratelimit-limit']).toBeDefined();
    expect(third.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('keeps successful responses inside the budget', async () => {
    app = await buildLimitedApp({ RATE_LIMIT_MAX: '10', RATE_LIMIT_WINDOW_MS: '60000' });

    const response = await app.inject({ method: 'GET', url: '/api/services' });
    expect(response.statusCode).toBe(200);
    expect(response.json<ServiceRegistryResponse>().services.length).toBeGreaterThan(0);
  });

  it('never throttles static/SPA paths, only /api routes', async () => {
    app = await buildLimitedApp({ RATE_LIMIT_MAX: '1', RATE_LIMIT_WINDOW_MS: '60000' });

    const first = await app.inject({ method: 'GET', url: '/console/buckets' });
    const second = await app.inject({ method: 'GET', url: '/console/buckets' });

    // Both hit the api's JSON 404 handler; neither is a 429. A page load
    // fetches dozens of hashed chunks and must not consume the api budget.
    expect(first.statusCode).toBe(404);
    expect(second.statusCode).toBe(404);
  });

  it('can be disabled with RATE_LIMIT_MAX=0', async () => {
    app = await buildLimitedApp({ RATE_LIMIT_MAX: '0' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/api/services' });
      expect(response.statusCode).toBe(200);
    }
  });
});
