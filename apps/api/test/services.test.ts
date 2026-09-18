import { SERVICE_CATALOG, SERVICE_CATEGORIES } from '@localdeck/shared';
import type {
  ApiErrorResponse,
  ServiceDetailResponse,
  ServiceOperationsResponse,
  ServiceRegistryResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * The registry routes never call LocalStack, so these tests point the api at a
 * port that nothing listens on: answering anyway is the point.
 */
const UNREACHABLE_ENDPOINT = 'http://127.0.0.1:1';

describe('service registry routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: UNREACHABLE_ENDPOINT,
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the full registry on GET /api/services without touching LocalStack', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceRegistryResponse>();
    expect(body.services).toHaveLength(SERVICE_CATALOG.length);
    expect(body.categories).toHaveLength(SERVICE_CATEGORIES.length);
    expect(body.categories.reduce((sum, entry) => sum + entry.serviceCount, 0)).toBe(
      SERVICE_CATALOG.length,
    );

    const s3 = body.services.find((service) => service.id === 's3');
    expect(s3?.displayName).toBe('S3');
    expect(s3?.operations).toContain('ListBuckets');
    expect(s3?.sdkPackage).toBe('@aws-sdk/client-s3');
    expect(s3?.parityLevel).toBe('dedicated');
  });

  it('resolves a single service and its LocalStack health keys', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services/elbv2' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceDetailResponse>();
    expect(body.service.id).toBe('elbv2');
    expect(body.service.displayName).toBe('Elastic Load Balancing');
    expect(body.localStackKeys).toEqual(['elbv2', 'elb']);
  });

  it('serves the whitelisted operations and the generic-browser binding', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services/sns/operations' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceOperationsResponse>();
    expect(body.service).toBe('sns');
    expect(body.operations).toContain('ListTopics');
    expect(body.operations).toContain('GetTopicAttributes');
    // The listOp carries the response mapping the generated browser renders.
    expect(body.browser?.list.operation).toBe('ListTopics');
    expect(body.browser?.list.resultPath).toBe('Topics');
    expect(body.browser?.list.idField).toBe('TopicArn');
    expect(body.browser?.describe).toEqual({
      operation: 'GetTopicAttributes',
      idParam: 'TopicArn',
    });
    expect(body.browser?.delete).toEqual({ operation: 'DeleteTopic', idParam: 'TopicArn' });
  });

  it('omits the browser binding for planned services', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services/support/operations' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ServiceOperationsResponse>();
    expect(body.service).toBe('support');
    expect(body.operations.length).toBeGreaterThan(0);
    expect(body.browser).toBeUndefined();
  });

  it('returns the shared 404 ApiError for an unknown service on the operations route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/services/not-a-service/operations',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details?.['serviceId']).toBe('not-a-service');
  });

  it('reports every health key for services that report under several keys', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services/timestream' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ServiceDetailResponse>().localStackKeys).toEqual([
      'timestream',
      'timestream-write',
      'timestream-query',
    ]);
  });

  it('returns the shared 404 ApiError for an unknown service id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services/not-a-service' });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.statusCode).toBe(404);
    expect(body.error.details?.['serviceId']).toBe('not-a-service');
  });
});
