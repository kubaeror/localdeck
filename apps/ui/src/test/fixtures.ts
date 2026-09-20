import {
  SERVICE_CATALOG,
  isApiErrorResponse,
  serviceCategories,
  summarizeServiceStates,
  type ApiConfigResponse,
  type ApiErrorResponse,
  type HealthResponse,
  type EmulatorServiceState,
  type ServiceRegistryResponse,
} from '@localdeck/shared';
import { vi } from 'vitest';

/**
 * Services the stubbed LocalStack reports. Deliberately partial: EC2, S3
 * Glacier, FSx and friends are missing so tests can assert that unreported
 * registry entries are greyed out instead of hidden.
 */
export const REPORTED_SERVICES: Record<string, EmulatorServiceState> = {
  s3: 'enabled',
  lambda: 'enabled',
  dynamodb: 'enabled',
  sqs: 'enabled',
  sns: 'enabled',
  logs: 'enabled',
  iam: 'enabled',
  ecs: 'enabled',
  ecr: 'enabled',
  cloudformation: 'enabled',
  stepfunctions: 'enabled',
  apigateway: 'enabled',
  elbv2: 'enabled',
  opensearch: 'enabled',
  secretsmanager: 'starting',
};

export const TEST_CONFIG: ApiConfigResponse = {
  application: { name: 'LocalDeck', version: '0.1.0', environment: 'test' },
  emulator: {
    provider: 'localstack',
    providerLabel: 'LocalStack',
    endpoint: 'http://localhost:4566',
    publicEndpoint: 'http://localhost:4566',
    region: 'us-east-1',
    healthPaths: ['/_localstack/health'],
  },
  ui: { statusPollIntervalMs: 60_000 },
};

export const TEST_HEALTH: HealthResponse = {
  status: 'ok',
  checkedAt: '2026-01-01T00:00:00.000Z',
  latencyMs: 21,
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
    services: REPORTED_SERVICES,
    rawServices: REPORTED_SERVICES,
    features: { persistence: 'disabled' },
    counts: summarizeServiceStates(REPORTED_SERVICES),
    ready: null,
  },
};

export const TEST_REGISTRY: ServiceRegistryResponse = {
  services: SERVICE_CATALOG,
  categories: serviceCategories(),
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const EMULATOR_UNREACHABLE: ApiErrorResponse = {
  error: {
    code: 'EMULATOR_UNREACHABLE',
    statusCode: 503,
    message:
      'LocalDeck api is running, but LocalStack is unreachable at http://localhost:4566 (ECONNREFUSED).',
    details: { endpoint: 'http://localhost:4566', reason: 'ECONNREFUSED' },
  },
};

/** Results the stubbed dispatcher answers with, per `service/operation`. */
export const TEST_OPERATION_RESULTS: Readonly<Record<string, unknown>> = {
  's3/ListBuckets': {
    service: 's3',
    operation: 'ListBuckets',
    result: { Buckets: [{ Name: 'alpha-bucket' }, { Name: 'beta-bucket' }] },
  },
  's3/CreateBucket': { service: 's3', operation: 'CreateBucket', result: {} },
  's3/DeleteBucket': { service: 's3', operation: 'DeleteBucket', result: {} },
  // Detail-tab reads. The "not configured" reads answer the way LocalStack
  // does (404 with the AWS error code) so the console exercises its empty
  // states instead of an error banner.
  's3/ListObjectsV2': {
    service: 's3',
    operation: 'ListObjectsV2',
    result: { Contents: [], CommonPrefixes: [], IsTruncated: false },
  },
  's3/GetBucketVersioning': {
    service: 's3',
    operation: 'GetBucketVersioning',
    result: { Status: 'Enabled' },
  },
  's3/GetBucketLocation': {
    service: 's3',
    operation: 'GetBucketLocation',
    result: { LocationConstraint: 'us-east-1' },
  },
  's3/GetBucketTagging': {
    error: {
      code: 'NoSuchTagSet',
      message: 'The TagSet does not exist',
      statusCode: 404,
    },
  },
  's3/GetBucketEncryption': {
    error: {
      code: 'ServerSideEncryptionConfigurationNotFoundError',
      message: 'The server side encryption configuration was not found',
      statusCode: 404,
    },
  },
  's3/GetBucketPolicy': {
    error: {
      code: 'NoSuchBucketPolicy',
      message: 'The bucket policy does not exist',
      statusCode: 404,
    },
  },
  's3/GetPublicAccessBlock': {
    error: {
      code: 'NoSuchPublicAccessBlockConfiguration',
      message: 'The public access block configuration was not found',
      statusCode: 404,
    },
  },
  's3/HeadObject': {
    service: 's3',
    operation: 'HeadObject',
    result: { ContentLength: 0, ContentType: 'application/octet-stream', Metadata: {} },
  },
  's3/DeleteObjects': {
    service: 's3',
    operation: 'DeleteObjects',
    result: { Deleted: [] },
  },
  's3/PutBucketVersioning': { service: 's3', operation: 'PutBucketVersioning', result: {} },
  's3/PutPublicAccessBlock': { service: 's3', operation: 'PutPublicAccessBlock', result: {} },
  's3/PutBucketTagging': { service: 's3', operation: 'PutBucketTagging', result: {} },
  's3/PutBucketPolicy': { service: 's3', operation: 'PutBucketPolicy', result: {} },
  's3/DeleteBucketPolicy': { service: 's3', operation: 'DeleteBucketPolicy', result: {} },
};

export interface StubApiOptions {
  /** Respond 503 with the shared error contract instead of a health document. */
  unreachable?: boolean;
  health?: HealthResponse;
  /** Extra or overriding dispatcher answers, keyed by `service/operation`. */
  operations?: Readonly<Record<string, unknown>>;
}

/** Installs a fetch stub that answers every /api route the console calls. */
export function stubApiFetch(options: StubApiOptions = {}): void {
  const operations = { ...TEST_OPERATION_RESULTS, ...(options.operations ?? {}) };

  const fetchMock: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/api/config')) return jsonResponse(TEST_CONFIG);

    // The dynamic dispatcher: /api/services/<service>/<operation>.
    const dispatched = /\/api\/services\/([^/?]+)\/([^/?]+)/.exec(url);
    if (dispatched !== null) {
      const key = `${dispatched[1] ?? ''}/${dispatched[2] ?? ''}`;
      const result = operations[key];
      if (result === undefined) {
        return jsonResponse(
          {
            error: {
              code: 'SDK_PACKAGE_UNAVAILABLE',
              statusCode: 501,
              message: `The LocalDeck api does not have the SDK package for ${key}.`,
            },
          },
          501,
        );
      }
      // A pre-built error response stands in for an AWS failure caught by the
      // dispatcher (404 NoSuchTagSet, and friends).
      if (isApiErrorResponse(result)) {
        return jsonResponse(result, result.error.statusCode);
      }
      return jsonResponse(result);
    }

    if (url.includes('/api/services')) return jsonResponse(TEST_REGISTRY);
    if (url.includes('/api/health')) {
      if (options.unreachable === true) return jsonResponse(EMULATOR_UNREACHABLE, 503);
      return jsonResponse(options.health ?? TEST_HEALTH);
    }
    return new Response('{}', { status: 404 });
  };
  vi.stubGlobal('fetch', vi.fn(fetchMock));
}

/** Number of dispatcher calls the stub served for one service/operation. */
export function dispatchedOperationCalls(service: string, operation: string): number {
  const mock = vi.mocked(globalThis.fetch);
  return mock.mock.calls.filter(([input]) =>
    String(input).includes(`/api/services/${service}/${operation}`),
  ).length;
}
