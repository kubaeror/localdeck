import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyAwsClients, type AwsSdkClient } from '../src/lib/awsClients.js';
import { ApiProblem } from '../src/lib/errors.js';
import {
  dispatchServiceOperation,
  resetUnsupportedOperationCache,
  sanitizeDispatcherResult,
  type DispatcherDependencies,
} from '../src/registry/dispatcher.js';

/**
 * Unit tests for the dynamic dispatcher with a fake SDK module map (LD-18).
 * They exercise real resolution, error mapping and result sanitization without
 * talking to LocalStack, plus the real registry descriptors for whitelisting.
 */

interface FakeClientState {
  sends: number;
  lastInput: unknown;
}

type FakeSend = (command: { input: unknown }) => Promise<unknown>;

/** One fake `*Client` class whose `send` is provided by the test. */
function clientClass(
  name: string,
  send: FakeSend,
  state: FakeClientState,
): new (config: unknown) => AwsSdkClient {
  class FakeClient implements AwsSdkClient {
    async send(command: { input: unknown }): Promise<unknown> {
      state.sends += 1;
      state.lastInput = command.input;
      return send(command);
    }

    destroy(): void {
      // Nothing to release in a fake client.
    }
  }
  Object.defineProperty(FakeClient, 'name', { value: name });
  return FakeClient;
}

function fakeModule(
  commands: Record<string, new (input: Record<string, unknown>) => { input: unknown }>,
  clients: Record<string, { new (config: unknown): AwsSdkClient }>,
): Record<string, unknown> {
  return { ...commands, ...clients };
}

function commandClass(): new (input: Record<string, unknown>) => { input: unknown } {
  return class Command {
    constructor(readonly input: Record<string, unknown>) {}
  };
}

function newState(): FakeClientState {
  return { sends: 0, lastInput: undefined };
}

function dependencies(module: Record<string, unknown>): DispatcherDependencies {
  return { loadSdkModule: async () => module };
}

async function expectProblem(promise: Promise<unknown>): Promise<ApiProblem> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiProblem);
    return error as ApiProblem;
  }
  throw new Error('expected the call to reject');
}

afterEach(() => {
  destroyAwsClients();
});

describe('dispatcher SDK module resolution', () => {
  it('prefers the client class derived from the package name', async () => {
    const state = newState();
    const Command = commandClass();
    const module = fakeModule(
      { ListBucketsCommand: Command },
      {
        // A legacy alias must lose against the package-derived name.
        LegacyS3: clientClass('LegacyS3', async () => ({ source: 'legacy' }), state),
        S3Client: clientClass('S3Client', async () => ({ source: 'package' }), state),
      },
    );

    const response = await dispatchServiceOperation(
      's3',
      'ListBuckets',
      {},
      {},
      dependencies(module),
    );
    expect(response.result).toEqual({ source: 'package' });
  });

  it('answers 501 when the module has no matching command class', async () => {
    const state = newState();
    const module = fakeModule({}, { S3Client: clientClass('S3Client', async () => ({}), state) });

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('SDK_PACKAGE_UNAVAILABLE');
    expect(problem.statusCode).toBe(501);
    expect(problem.details?.['operation']).toBe('ListBuckets');
  });

  it('answers 501 for a client class it cannot pick unambiguously', async () => {
    const state = newState();
    const module = fakeModule(
      { ListBucketsCommand: commandClass() },
      {
        AlphaClient: clientClass('AlphaClient', async () => ({}), state),
        BetaClient: clientClass('BetaClient', async () => ({}), state),
      },
    );

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('SDK_PACKAGE_UNAVAILABLE');
    expect(problem.message).toContain('several client classes');
  });

  it('blocks services registered as planned placeholders', async () => {
    const state = newState();
    const module = fakeModule(
      { GetCallerIdentityCommand: commandClass() },
      { STSClient: clientClass('STSClient', async () => ({}), state) },
    );

    const problem = await expectProblem(
      dispatchServiceOperation('sts', 'GetCallerIdentity', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('SERVICE_PLANNED');
    expect(problem.statusCode).toBe(501);
    expect(state.sends).toBe(0);
  });
});

describe('dispatcher error mapping (real Smithy shape)', () => {
  function throwingModule(error: unknown): {
    module: Record<string, unknown>;
    state: FakeClientState;
  } {
    const state = newState();
    const module = fakeModule(
      { ListBucketsCommand: commandClass() },
      {
        S3Client: clientClass('S3Client', async () => Promise.reject(error), state),
      },
    );
    return { module, state };
  }

  /** A Smithy error as real SDK clients throw it: no `$service` property. */
  function smithyError(
    name: string,
    httpStatusCode: number,
    extras: { requestId?: string } = {},
  ): Error {
    const error = new Error(`${name} raised by the SDK`);
    error.name = name;
    Object.assign(error, {
      $fault: httpStatusCode >= 500 ? 'server' : 'client',
      $metadata: {
        httpStatusCode,
        ...(extras.requestId === undefined ? {} : { requestId: extras.requestId }),
        attempts: 1,
      },
    });
    return error;
  }

  it('fills ApiError.service from the registry descriptor', async () => {
    const { module } = throwingModule(smithyError('NoSuchBucket', 404, { requestId: 'req-9' }));

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    const apiError = problem.toApiError();
    expect(apiError.code).toBe('NoSuchBucket');
    expect(apiError.statusCode).toBe(404);
    expect(apiError.requestId).toBe('req-9');
    expect(apiError.service).toBe('s3');
  });

  it('maps server faults to 502 and keeps the service id', async () => {
    const { module } = throwingModule(smithyError('InternalFailure', 500));

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    const apiError = problem.toApiError();
    expect(apiError.statusCode).toBe(502);
    expect(apiError.service).toBe('s3');
  });

  it('maps connection failures to 503 EMULATOR_UNREACHABLE', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4566'), {
      code: 'ECONNREFUSED',
    });
    const { module } = throwingModule(refused);

    const problem = await expectProblem(
      dispatchServiceOperation(
        's3',
        'ListBuckets',
        {},
        { endpoint: 'http://127.0.0.1:4566' },
        dependencies(module),
      ),
    );
    expect(problem.code).toBe('EMULATOR_UNREACHABLE');
    expect(problem.statusCode).toBe(503);
  });

  it('maps request timeouts to 504 instead of unreachable', async () => {
    const timeout = Object.assign(
      new Error(
        '@smithy/node-http-handler - [ERROR] a request has exceeded the configured 400 ms requestTimeout.',
      ),
      { name: 'TimeoutError', code: 'ETIMEDOUT' },
    );
    const { module } = throwingModule(timeout);

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('EMULATOR_TIMEOUT');
    expect(problem.statusCode).toBe(504);
  });

  it('maps AbortError to 408 REQUEST_ABORTED', async () => {
    const aborted = Object.assign(new Error('Request aborted'), { name: 'AbortError' });
    const { module } = throwingModule(aborted);

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('REQUEST_ABORTED');
    expect(problem.statusCode).toBe(408);
  });

  it('maps SDK serializer TypeErrors to 400 VALIDATION_FAILED', async () => {
    const { module } = throwingModule(
      new TypeError(
        'The first argument must be of type string or an instance of Buffer. Received type number (5)',
      ),
    );

    const problem = await expectProblem(
      dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module)),
    );
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.statusCode).toBe(400);
    expect(problem.details?.['reason']).toBe('sdk-input-serialization');
  });
});

describe('dispatcher result sanitization', () => {
  it('base64-encodes Uint8Array and ArrayBuffer blobs', () => {
    expect(sanitizeDispatcherResult(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    expect(sanitizeDispatcherResult(new TextEncoder().encode('hi').buffer)).toBe('aGk=');
  });

  it('leaves plain JSON results untouched in shape', () => {
    const result = sanitizeDispatcherResult({
      Buckets: [{ Name: 'a', CreationDate: new Date('2026-01-01T00:00:00.000Z') }],
      $metadata: { httpStatusCode: 200 },
    });
    expect(result).toEqual({
      Buckets: [{ Name: 'a', CreationDate: new Date('2026-01-01T00:00:00.000Z') }],
      $metadata: { httpStatusCode: 200 },
    });
  });

  it('destroys streams and rejects with 501 BINARY_RESPONSE_UNSUPPORTED', async () => {
    const body = Readable.from([Buffer.from('object bytes')]);
    let problem: ApiProblem | undefined;
    try {
      sanitizeDispatcherResult({ Body: body });
    } catch (error) {
      problem = error as ApiProblem;
    }
    expect(problem?.code).toBe('BINARY_RESPONSE_UNSUPPORTED');
    expect(problem?.statusCode).toBe(501);
    // The response socket must not stay open.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(body.destroyed).toBe(true);
  });

  it('rejects streamed SDK results through the whole dispatcher path', async () => {
    const state = newState();
    const Command = commandClass();
    const module = fakeModule(
      { GetObjectCommand: Command },
      {
        S3Client: clientClass(
          'S3Client',
          async () => ({ Body: Readable.from([Buffer.from('bytes')]) }),
          state,
        ),
      },
    );

    const problem = await expectProblem(
      dispatchServiceOperation(
        's3',
        'GetObject',
        { Bucket: 'b', Key: 'k' },
        {},
        dependencies(module),
      ),
    );
    expect(problem.code).toBe('BINARY_RESPONSE_UNSUPPORTED');
    expect(problem.statusCode).toBe(501);
  });

  it('base64-encodes blobs through the whole dispatcher path', async () => {
    const state = newState();
    const Command = commandClass();
    const module = fakeModule(
      { GetSecretValueCommand: Command },
      {
        SecretsManagerClient: clientClass(
          'SecretsManagerClient',
          async () => ({ Name: 'demo', SecretBinary: new Uint8Array([104, 105]) }),
          state,
        ),
      },
    );

    const response = await dispatchServiceOperation(
      'secretsmanager',
      'GetSecretValue',
      { SecretId: 'demo' },
      {},
      dependencies(module),
    );
    expect(response.result).toEqual({ Name: 'demo', SecretBinary: 'aGk=' });
  });
});

describe('dispatcher input passthrough', () => {
  it('passes the parsed operation input to the command unchanged', async () => {
    const state = newState();
    const Command = commandClass();
    const module = fakeModule(
      { ListBucketsCommand: Command },
      { S3Client: clientClass('S3Client', async () => ({ Buckets: [] }), state) },
    );

    const input = { Bucket: 'b', MaxKeys: 5, Metadata: { a: 'b' } };
    await dispatchServiceOperation('s3', 'ListBuckets', input, {}, dependencies(module));
    expect(state.lastInput).toBe(input);
  });
});

describe('dispatcher result sanitization of prototype-shaped keys', () => {
  it('preserves a __proto__ key as an own property instead of mutating the prototype', () => {
    const source = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}') as Record<
      string,
      unknown
    >;
    const result = sanitizeDispatcherResult(source) as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({
      polluted: true,
    });
    expect(result['ok']).toBe(1);
    // Object.prototype must not be polluted.
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('dispatcher learned unsupported operations', () => {
  afterEach(() => {
    resetUnsupportedOperationCache();
  });

  it('answers 501 EMULATOR_OPERATION_UNSUPPORTED after the first rejection', async () => {
    const state = newState();
    const Command = commandClass();
    const module = fakeModule(
      { ListBucketsCommand: Command },
      {
        S3Client: clientClass(
          'S3Client',
          async () => {
            const error = new Error('This operation is not implemented yet');
            error.name = 'NotImplementedException';
            Object.assign(error, { $metadata: { httpStatusCode: 501 } });
            throw error;
          },
          state,
        ),
      },
    );

    const first = await dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module))
      .then(() => undefined)
      .catch((error: unknown) => error as ApiProblem);
    expect(first?.code).toBe('EMULATOR_OPERATION_UNSUPPORTED');
    expect(first?.statusCode).toBe(501);
    expect(state.sends).toBe(1);

    const second = await dispatchServiceOperation('s3', 'ListBuckets', {}, {}, dependencies(module))
      .then(() => undefined)
      .catch((error: unknown) => error as ApiProblem);
    expect(second?.code).toBe('EMULATOR_OPERATION_UNSUPPORTED');
    expect(second?.details?.['reason']).toBe('learned-unsupported');
    // The second call was rejected before touching the SDK again.
    expect(state.sends).toBe(1);
  });
});
