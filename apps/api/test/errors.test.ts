import { describe, expect, it } from 'vitest';
import {
  describeNetworkFailure,
  findNetworkErrorCode,
  EmulatorUnreachableProblem,
  isUnsupportedOperationError,
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
    const problem = new EmulatorUnreachableProblem({
      endpoint: 'http://localhost:4566',
      reason: 'connection failed (ECONNREFUSED)',
    });

    const apiError = toApiError(problem);
    expect(apiError.code).toBe('EMULATOR_UNREACHABLE');
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

  it('fills ApiError.service from the registry context for real Smithy errors', () => {
    // Real Smithy errors have `$fault` + `$metadata` but never `$service`.
    const real = new Error('the bucket does not exist');
    real.name = 'NoSuchBucket';
    Object.assign(real, {
      $fault: 'client',
      $metadata: { httpStatusCode: 404, requestId: 'req-real' },
    });

    const apiError = toApiError(real, { service: 's3' });
    expect(apiError.code).toBe('NoSuchBucket');
    expect(apiError.service).toBe('s3');
    expect(apiError.requestId).toBe('req-real');
  });

  it('maps request timeouts to 504 before the network mapping', () => {
    const timeout = Object.assign(
      new Error(
        '@smithy/node-http-handler - [ERROR] a request has exceeded the configured 400 ms requestTimeout.',
      ),
      { name: 'TimeoutError', code: 'ETIMEDOUT' },
    );

    const apiError = toApiError(timeout, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('EMULATOR_TIMEOUT');
    expect(apiError.statusCode).toBe(504);
    expect(apiError.message).toContain('did not finish');
  });

  it('keeps a connection timeout classified as unreachable', () => {
    const connectTimeout = Object.assign(
      new Error('the request socket did not establish a connection with the server within 500 ms'),
      { name: 'TimeoutError' },
    );

    const apiError = toApiError(connectTimeout, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('EMULATOR_UNREACHABLE');
    expect(apiError.statusCode).toBe(503);
  });

  it('maps AbortError to 408 REQUEST_ABORTED, not unreachable', () => {
    const aborted = Object.assign(new Error('Request aborted'), { name: 'AbortError' });

    const apiError = toApiError(aborted, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('REQUEST_ABORTED');
    expect(apiError.statusCode).toBe(408);
  });

  it('treats AbortSignal.timeout aborts as timeouts', () => {
    const timeoutReason = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const aborted = Object.assign(new Error('Request aborted'), {
      name: 'AbortError',
      cause: timeoutReason,
    });

    const apiError = toApiError(aborted);
    expect(apiError.code).toBe('EMULATOR_TIMEOUT');
    expect(apiError.statusCode).toBe(504);
  });

  it('maps SDK serializer TypeErrors to 400 VALIDATION_FAILED', () => {
    const apiError = toApiError(
      new TypeError('The first argument must be of type string or an instance of Buffer.'),
      { service: 'lambda' },
    );

    expect(apiError.code).toBe('VALIDATION_FAILED');
    expect(apiError.statusCode).toBe(400);
    expect(apiError.details?.['reason']).toBe('sdk-input-serialization');
  });

  it('maps Fastify handler timeouts to 504 EMULATOR_TIMEOUT', () => {
    const handlerTimeout = Object.assign(
      new Error("Request timed out after 30000 ms on route '/'"),
      {
        code: 'FST_ERR_HANDLER_TIMEOUT',
        statusCode: 503,
      },
    );

    const apiError = toApiError(handlerTimeout, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('EMULATOR_TIMEOUT');
    expect(apiError.statusCode).toBe(504);
  });

  it('maps connection failures to 503 EMULATOR_UNREACHABLE with the endpoint', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4566'), {
      code: 'ECONNREFUSED',
    });

    const apiError = toApiError(refused, { endpoint: 'http://localhost:4566' });
    expect(apiError.code).toBe('EMULATOR_UNREACHABLE');
    expect(apiError.statusCode).toBe(503);
    expect(apiError.message).toContain('http://localhost:4566');
    expect(apiError.details?.['reason']).toBe('ECONNREFUSED');
  });

  it('finds network codes nested in a cause chain', () => {
    const nested = new Error('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });

    expect(findNetworkErrorCode(nested)).toBe('ECONNREFUSED');
    expect(toApiError(nested).code).toBe('EMULATOR_UNREACHABLE');
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

  it('names the pinned provider in unreachable copy', () => {
    const apiError = toApiError(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      { endpoint: 'http://localhost:4566', emulatorLabel: 'MiniStack' },
    );

    expect(apiError.code).toBe('EMULATOR_UNREACHABLE');
    expect(apiError.message).toContain('MiniStack');
  });

  it('maps emulator "not implemented" failures to EMULATOR_OPERATION_UNSUPPORTED', () => {
    const notImplemented = Object.assign(new Error('This operation is not implemented yet'), {
      name: 'NotImplementedException',
      $fault: 'server',
      $metadata: { httpStatusCode: 501 },
    });

    const apiError = toApiError(notImplemented, { service: 'glue', operation: 'StartJobRun' });
    expect(apiError.code).toBe('EMULATOR_OPERATION_UNSUPPORTED');
    expect(apiError.statusCode).toBe(501);
    expect(apiError.message).toContain('glue');
    expect(apiError.message).toContain('StartJobRun');
    expect(apiError.details?.['operation']).toBe('StartJobRun');
  });

  it('recognizes unsupported-operation failures by name, status and message', () => {
    expect(isUnsupportedOperationError({ httpStatusCode: 501 })).toBe(true);
    expect(
      isUnsupportedOperationError(Object.assign(new Error('x'), { name: 'NotImplemented' })),
    ).toBe(true);
    expect(
      isUnsupportedOperationError(new Error('Unsupported operation: DeleteBucketPolicy')),
    ).toBe(true);
    expect(
      isUnsupportedOperationError(new Error('the service is disabled in this configuration')),
    ).toBe(true);
    expect(isUnsupportedOperationError(new Error('NoSuchBucket'))).toBe(false);
    expect(isUnsupportedOperationError(new TypeError('bad input'))).toBe(false);
  });
});
