import { describe, expect, it } from 'vitest';
import {
  describeNetworkFailure,
  findNetworkErrorCode,
  LocalStackUnreachableProblem,
  toApiError,
} from '../src/lib/errors.js';

function awsSdkError(
  name: string,
  httpStatusCode: number,
  extras: { requestId?: string; service?: string } = {},
): Error {
  const error = new Error(`${name} was raised by the SDK`);
  error.name = name;
  Object.assign(error, {
    $fault: httpStatusCode >= 500 ? 'server' : 'client',
    ...(extras.service === undefined ? {} : { $service: extras.service }),
    $metadata: {
      httpStatusCode,
      ...(extras.requestId === undefined ? {} : { requestId: extras.requestId }),
      attempts: 1,
    },
  });
  return error;
}

describe('toApiError', () => {
  it('keeps ApiProblem errors intact', () => {
    const problem = new LocalStackUnreachableProblem({
      endpoint: 'http://localhost:4566',
      reason: 'connection failed (ECONNREFUSED)',
    });

    const apiError = toApiError(problem);
    expect(apiError.code).toBe('LOCALSTACK_UNREACHABLE');
    expect(apiError.statusCode).toBe(503);
    expect(apiError.details?.['endpoint']).toBe('http://localhost:4566');
  });

  it('passes AWS client errors through with their request id and service', () => {
    const apiError = toApiError(
      awsSdkError('NoSuchBucket', 404, { requestId: 'req-123', service: 'S3' }),
    );

    expect(apiError.code).toBe('NoSuchBucket');
    expect(apiError.statusCode).toBe(404);
    expect(apiError.requestId).toBe('req-123');
    expect(apiError.service).toBe('S3');
    expect(apiError.details?.['upstreamStatusCode']).toBe(404);
  });

  it('maps AWS server faults to 502 instead of leaking a 5xx upstream status', () => {
    const apiError = toApiError(awsSdkError('InternalFailure', 500, { service: 'Lambda' }));

    expect(apiError.code).toBe('InternalFailure');
    expect(apiError.statusCode).toBe(502);
    expect(apiError.service).toBe('Lambda');
  });

  it('maps connection failures to 503 LOCALSTACK_UNREACHABLE with the endpoint', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4566'), {
      code: 'ECONNREFUSED',
    });

    const apiError = toApiError(refused, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('LOCALSTACK_UNREACHABLE');
    expect(apiError.statusCode).toBe(503);
    expect(apiError.message).toContain('http://localhost:4566');
    expect(apiError.details?.['reason']).toBe('ECONNREFUSED');
  });

  it('finds network codes nested in a cause chain', () => {
    const nested = new Error('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });

    expect(findNetworkErrorCode(nested)).toBe('ECONNREFUSED');
    expect(toApiError(nested).code).toBe('LOCALSTACK_UNREACHABLE');
  });

  it('describes undici connection failures instead of the generic "fetch failed"', () => {
    const undiciError = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), {
        code: 'ECONNREFUSED',
      }),
    });

    expect(describeNetworkFailure(undiciError)).toBe('ECONNREFUSED');
  });

  it('digs through AggregateError entries', () => {
    const aggregate = new TypeError('fetch failed', {
      cause: new AggregateError([
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }),
      ]),
    });

    expect(findNetworkErrorCode(aggregate)).toBe('ECONNREFUSED');
    expect(describeNetworkFailure(aggregate)).toBe('ECONNREFUSED');
  });

  it('maps multipart upload failures to actionable codes', () => {
    const tooLarge = Object.assign(new Error('request file too large'), {
      code: 'FST_REQ_FILE_TOO_LARGE',
      statusCode: 413,
    });
    const apiError = toApiError(tooLarge);
    expect(apiError.code).toBe('PAYLOAD_TOO_LARGE');
    expect(apiError.statusCode).toBe(413);
    expect(apiError.message).toContain('5 GiB');

    const notMultipart = Object.assign(new Error('the request is not multipart'), {
      code: 'FST_INVALID_MULTIPART_CONTENT_TYPE',
      statusCode: 406,
    });
    const contract = toApiError(notMultipart);
    expect(contract.code).toBe('VALIDATION_FAILED');
    expect(contract.statusCode).toBe(400);
    expect(contract.message).toContain('multipart/form-data');
  });

  it('maps Fastify validation errors to 400 without exposing internals', () => {
    const validationError = Object.assign(new Error('body must have required property name'), {
      code: 'FST_ERR_VALIDATION',
      statusCode: 400,
      validation: [{ instancePath: '/name', message: 'is required' }],
    });

    const apiError = toApiError(validationError);
    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.statusCode).toBe(400);
    expect(apiError.details?.['issues']).toBeDefined();
  });

  it('never leaks an unexpected error message to the client', () => {
    const apiError = toApiError(new Error('secret internal detail: password=hunter2'));

    expect(apiError.code).toBe('INTERNAL_ERROR');
    expect(apiError.statusCode).toBe(500);
    expect(apiError.message).not.toContain('hunter2');
  });
});
