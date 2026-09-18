import { ApiErrorCodes, type ApiError } from '@localdeck/shared';

export interface ApiProblemInit {
  code: string;
  message: string;
  statusCode: number;
  requestId?: string;
  service?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * An error that is already shaped for the client. Thrown by LocalDeck's own
 * code; the central Fastify error handler serializes it unchanged.
 */
export class ApiProblem extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | undefined;
  readonly service: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: ApiProblemInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiProblem';
    this.code = init.code;
    this.statusCode = init.statusCode;
    this.requestId = init.requestId;
    this.service = init.service;
    this.details = init.details;
  }

  toApiError(): ApiError {
    const error: ApiError = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
    if (this.requestId !== undefined) error.requestId = this.requestId;
    if (this.service !== undefined) error.service = this.service;
    if (this.details !== undefined) error.details = this.details;
    return error;
  }
}

/** The configured local emulator could not be reached at all. */
export class EmulatorUnreachableProblem extends ApiProblem {
  constructor(args: {
    endpoint: string;
    reason: string;
    providerLabel?: string;
    hint?: string;
    cause?: unknown;
  }) {
    const label = args.providerLabel ?? 'the local emulator';
    super({
      code: ApiErrorCodes.emulatorUnreachable,
      statusCode: 503,
      message:
        `LocalDeck api is running, but ${label} is unreachable at ${args.endpoint} ` +
        `(${args.reason}). Start the emulator, or point EMULATOR_ENDPOINT at the ` +
        'instance you want this console to manage.',
      details: {
        endpoint: args.endpoint,
        reason: args.reason,
        ...(args.providerLabel === undefined ? {} : { provider: args.providerLabel }),
        ...(args.hint === undefined ? {} : { hint: args.hint }),
      },
      cause: args.cause,
    });
  }
}

/** The emulator answered, but not with a health document we understand. */
export class EmulatorInvalidResponseProblem extends ApiProblem {
  constructor(args: { endpoint: string; reason: string; providerLabel?: string; cause?: unknown }) {
    const label = args.providerLabel ?? 'The emulator';
    super({
      code: ApiErrorCodes.emulatorInvalidResponse,
      statusCode: 502,
      message: `${label} at ${args.endpoint} returned an unexpected health response (${args.reason}).`,
      details: {
        endpoint: args.endpoint,
        reason: args.reason,
        ...(args.providerLabel === undefined ? {} : { provider: args.providerLabel }),
      },
      cause: args.cause,
    });
  }
}

/** Node/undici error codes that mean "nothing is listening / no route". */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const NETWORK_ERROR_NAMES = new Set(['ConnectTimeoutError']);

/**
 * Walks `cause` and `errors` chains (undici nests the real failure there) and
 * returns the first record the visitor accepts.
 */
export function walkErrorChain(
  error: unknown,
  visit: (record: Record<string, unknown>) => boolean,
  depth = 0,
): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (visit(record)) return true;

  const nested = record.errors;
  if (Array.isArray(nested)) {
    for (const entry of nested) {
      if (walkErrorChain(entry, visit, depth + 1)) return true;
    }
  }
  return walkErrorChain(record.cause, visit, depth + 1);
}

/** Finds a Node/undici network error code anywhere in the error chain. */
export function findNetworkErrorCode(error: unknown): string | undefined {
  let found: string | undefined;
  walkErrorChain(error, (record) => {
    const code = record.code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
      found = code;
      return true;
    }
    const name = record.name;
    if (typeof name === 'string' && NETWORK_ERROR_NAMES.has(name)) {
      found = name;
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Human-readable reason for a failed connection: the deepest error code or
 * message, skipping undici's unhelpful top-level "fetch failed".
 */
export function describeNetworkFailure(error: unknown): string | undefined {
  let found: string | undefined;
  walkErrorChain(error, (record) => {
    const code = record.code;
    if (typeof code === 'string' && code.length > 0) {
      found = code;
      return true;
    }
    const message = record.message;
    if (typeof message === 'string' && message.length > 0 && !/^fetch failed$/i.test(message)) {
      found = message;
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Classification of a request-level failure, checked before the generic
 * network mapping so an aborted or timed-out call is never reported as
 * "LocalStack is unreachable".
 *
 * - `timeout` — the SDK's request handler or AbortSignal.timeout gave up
 *   waiting for a response (HTTP 504).
 * - `connection-timeout` — the TCP connection was never established, which
 *   really does mean LocalStack is not accepting connections (HTTP 503).
 * - `aborted` — the caller went away or Fastify's handler timeout fired
 *   (HTTP 408).
 */
export type RequestFailureKind = 'timeout' | 'connection-timeout' | 'aborted';

export function classifyRequestFailure(error: unknown): RequestFailureKind | undefined {
  let sawAbort = false;
  let sawTimeout = false;
  walkErrorChain(error, (record) => {
    if (record.name === 'AbortError') {
      sawAbort = true;
      return true;
    }
    if (record.name === 'TimeoutError') {
      sawTimeout = true;
      return true;
    }
    return false;
  });

  // AbortSignal.timeout aborts the request; the SDK wraps the DOMException in
  // an AbortError, so a TimeoutError anywhere in the chain still means timeout.
  if (sawAbort) {
    walkErrorChain(error, (record) => {
      if (record.name === 'TimeoutError') {
        sawTimeout = true;
        return true;
      }
      return false;
    });
  }

  if (sawTimeout) {
    const message = describeNetworkFailure(error) ?? '';
    // @smithy/node-http-handler uses TimeoutError for both the connect and the
    // request timeout; only the connect one means "nothing is listening".
    return /did not establish a connection/i.test(message) ? 'connection-timeout' : 'timeout';
  }
  return sawAbort ? 'aborted' : undefined;
}

interface AwsSdkErrorLike {
  name: string;
  message: string;
  httpStatusCode: number | undefined;
  requestId: string | undefined;
  service: string | undefined;
}

function asAwsSdkError(error: unknown): AwsSdkErrorLike | null {
  if (!(error instanceof Error)) return null;
  // SDK serialization/parameter errors are plain TypeErrors; AWS service
  // exceptions are Error subclasses, never TypeErrors. The retry middleware
  // decorates them with $metadata.attempts, so they must not be mistaken for
  // service errors just because the name ends in "Error".
  if (error instanceof TypeError) return null;
  const candidate = error as Error & Record<string, unknown>;
  const metadata = candidate.$metadata;
  const metadataRecord =
    typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {};
  const httpStatusCode = metadataRecord.httpStatusCode;
  const service = candidate.$service;
  const fault = candidate.$fault;
  const looksLikeSdkError =
    typeof httpStatusCode === 'number' ||
    typeof service === 'string' ||
    typeof fault === 'string' ||
    (/(?:Exception|ServiceException|Error)$/.test(candidate.name) &&
      Object.keys(metadataRecord).length > 0);

  if (!looksLikeSdkError) return null;

  const requestId = metadataRecord.requestId;
  return {
    name: candidate.name,
    message: candidate.message,
    httpStatusCode: typeof httpStatusCode === 'number' ? httpStatusCode : undefined,
    requestId: typeof requestId === 'string' ? requestId : undefined,
    service: typeof service === 'string' ? service : undefined,
  };
}

function mapAwsSdkError(error: AwsSdkErrorLike, context: ErrorContext): ApiError {
  const upstream = error.httpStatusCode ?? 500;
  const service = error.service ?? context.service;

  // Emulators implement different operation subsets. Surface "this emulator
  // does not implement it" instead of an opaque upstream 5xx; the ui turns
  // this code into a disabled action with an explanation.
  if (isUnsupportedOperationError(error)) {
    const subject = service === undefined ? 'This service' : `"${service}"`;
    const operation = context.operation === undefined ? 'this operation' : `"${context.operation}"`;
    return {
      code: ApiErrorCodes.emulatorOperationUnsupported,
      statusCode: 501,
      message:
        `${subject} does not implement ${operation} on the active local emulator. ` +
        'Open the service console for supported actions, or use the provider-specific docs.',
      details: {
        upstreamStatusCode: upstream,
        ...(service === undefined ? {} : { service }),
        ...(context.operation === undefined ? {} : { operation: context.operation }),
        reason: error.name,
        upstreamMessage: error.message.slice(0, 500),
      },
    };
  }

  // 4xx from the emulator is the caller's problem; 5xx is an upstream failure.
  const statusCode = upstream >= 400 && upstream < 500 ? upstream : 502;
  // Smithy never writes `$service`; fall back to the registry descriptor id the
  // dispatcher passed in, so `ApiError.service` is populated for real errors.
  const apiError: ApiError = {
    code: error.name.length > 0 ? error.name : ApiErrorCodes.awsSdkError,
    message: error.message.length > 0 ? error.message : `AWS SDK call failed with ${error.name}.`,
    statusCode,
  };
  if (error.requestId !== undefined) apiError.requestId = error.requestId;
  if (service !== undefined) apiError.service = service;
  apiError.details = {
    upstreamStatusCode: upstream,
    ...(context.endpoint === undefined ? {} : { endpoint: context.endpoint }),
  };
  return apiError;
}

const UNSUPPORTED_OPERATION_NAMES = new Set([
  'NotImplemented',
  'NotImplementedException',
  'UnsupportedOperation',
  'UnsupportedOperationException',
  'UnknownOperationException',
  'UnknownOperation',
]);

const UNSUPPORTED_OPERATION_MESSAGE =
  /not (?:yet )?(?:implemented|supported)|unsupported operation|unknown operation|operation .* is not (?:available|implemented|supported)|service .*?(?:is )?(?:disabled|not enabled)/i;

/**
 * True when an SDK failure means "this emulator does not implement the
 * operation" rather than a transient or configuration problem.
 */
export function isUnsupportedOperationError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const httpStatusCode = record.httpStatusCode;
    if (httpStatusCode === 501) return true;
    const metadata = record.$metadata;
    if (typeof metadata === 'object' && metadata !== null) {
      const metadataStatus = (metadata as Record<string, unknown>).httpStatusCode;
      if (metadataStatus === 501) return true;
    }
  }
  if (error instanceof Error && UNSUPPORTED_OPERATION_NAMES.has(error.name)) return true;
  const message = error instanceof Error ? error.message : undefined;
  return message !== undefined && message.length > 0 && UNSUPPORTED_OPERATION_MESSAGE.test(message);
}

interface FastifyLikeError {
  code?: unknown;
  statusCode?: unknown;
  validation?: unknown;
  message?: unknown;
}

/**
 * Upload failures raised by @fastify/multipart before an S3 call is made. They
 * are mapped to the shared contract so the console can show something a person
 * can act on instead of an FST_* code.
 */
const MULTIPART_ERRORS: Readonly<Record<string, Omit<ApiError, 'code'> & { code: string }>> = {
  FST_REQ_FILE_TOO_LARGE: {
    code: ApiErrorCodes.payloadTooLarge,
    statusCode: 413,
    message: 'The file is larger than the 5 GiB single-object limit S3 accepts.',
  },
  FST_FILES_LIMIT: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'Upload one file per request; repeat the request for additional files.',
  },
  FST_PARTS_LIMIT: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'The upload contained more parts than the proxy accepts.',
  },
  FST_FIELDS_LIMIT: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'Send the upload target as query parameters (bucket, key), not as form fields.',
  },
  FST_INVALID_MULTIPART_CONTENT_TYPE: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'Uploads must use multipart/form-data with a single file part named "file".',
  },
  FST_MP_PREMATURE_CLOSE: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'The upload was interrupted before every byte arrived.',
  },
  FST_PROTO_VIOLATION: {
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: 'The multipart form contained an unsafe field name.',
  },
};

function asFastifyError(error: unknown): FastifyLikeError | null {
  if (typeof error !== 'object' || error === null) return null;
  return error as FastifyLikeError;
}

export interface ErrorContext {
  endpoint?: string;
  /** Registry service id, used when a real SDK error carries no `$service`. */
  service?: string;
  /** Registry operation name, used for unsupported-operation messages. */
  operation?: string;
  /** Display name of the active emulator ("LocalStack", "MiniStack", "Floci"). */
  emulatorLabel?: string;
}

/** Copy used for network failures when no provider has been identified yet. */
function emulatorLabelOf(context: ErrorContext): string {
  return context.emulatorLabel ?? 'the local emulator';
}

/**
 * Single mapping point from "anything thrown in a route" to the shared
 * ApiError contract. Never leaks stack traces or credentials.
 */
export function toApiError(error: unknown, context: ErrorContext = {}): ApiError {
  if (error instanceof ApiProblem) return error.toApiError();

  const asRecord = asFastifyError(error);
  if (asRecord !== null && typeof asRecord.code === 'string') {
    const multipartError = MULTIPART_ERRORS[asRecord.code];
    if (multipartError !== undefined) return { ...multipartError };
    // Fastify's handlerTimeout aborts request.signal and sends this error; it
    // means the emulator never answered, not that the api crashed.
    if (asRecord.code === 'FST_ERR_HANDLER_TIMEOUT') {
      const label = emulatorLabelOf(context);
      return {
        code: ApiErrorCodes.emulatorTimeout,
        statusCode: 504,
        message:
          `${label} did not answer the operation within the configured timeout` +
          `${context.endpoint === undefined ? '' : ` at ${context.endpoint}`}.`,
        details: {
          endpoint: context.endpoint ?? null,
          reason: 'handler-timeout',
        },
      };
    }
  }

  // Timeouts and client aborts are request-level outcomes: classify them before
  // the network mapping so they are never reported as "the emulator is down".
  const requestFailure = classifyRequestFailure(error);
  if (requestFailure === 'timeout') {
    const reason = describeNetworkFailure(error);
    const label = emulatorLabelOf(context);
    return {
      code: ApiErrorCodes.emulatorTimeout,
      statusCode: 504,
      message:
        `${label} accepted the connection but did not finish the operation in time` +
        `${context.endpoint === undefined ? '' : ` at ${context.endpoint}`}` +
        `${reason === undefined ? '' : ` (${reason})`}.`,
      details: {
        endpoint: context.endpoint ?? null,
        reason: reason ?? 'timeout',
      },
      ...(context.service === undefined ? {} : { service: context.service }),
    };
  }
  if (requestFailure === 'aborted') {
    return {
      code: ApiErrorCodes.requestAborted,
      statusCode: 408,
      message: 'The request was aborted before the emulator answered.',
      details: { endpoint: context.endpoint ?? null, reason: 'request-aborted' },
      ...(context.service === undefined ? {} : { service: context.service }),
    };
  }
  if (requestFailure === 'connection-timeout') {
    const endpoint = context.endpoint ?? 'the configured emulator endpoint';
    const label = emulatorLabelOf(context);
    return {
      code: ApiErrorCodes.emulatorUnreachable,
      statusCode: 503,
      message:
        `LocalDeck api is running, but ${label} is unreachable at ${endpoint} (connection timeout). ` +
        'Start the emulator, or point EMULATOR_ENDPOINT at the instance you want to manage.',
      details: { endpoint: context.endpoint ?? null, reason: 'connection-timeout' },
    };
  }

  const networkCode = findNetworkErrorCode(error);
  if (networkCode !== undefined) {
    const endpoint = context.endpoint ?? 'the configured emulator endpoint';
    const label = emulatorLabelOf(context);
    return {
      code: ApiErrorCodes.emulatorUnreachable,
      statusCode: 503,
      message:
        `LocalDeck api is running, but ${label} is unreachable at ${endpoint} (${networkCode}). ` +
        'Start the emulator, or point EMULATOR_ENDPOINT at the instance you want to manage.',
      details: { endpoint: context.endpoint ?? null, reason: networkCode },
    };
  }

  const sdkError = asAwsSdkError(error);
  if (sdkError !== null) return mapAwsSdkError(sdkError, context);

  const fastifyError = asFastifyError(error);
  if (fastifyError !== null) {
    if (Array.isArray(fastifyError.validation)) {
      return {
        code: ApiErrorCodes.validationFailed,
        statusCode: 400,
        message: 'The request did not pass validation.',
        details: { issues: fastifyError.validation },
      };
    }
    const statusCode = fastifyError.statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return {
        code:
          typeof fastifyError.code === 'string' && fastifyError.code.length > 0
            ? fastifyError.code
            : ApiErrorCodes.validationFailed,
        statusCode,
        message:
          typeof fastifyError.message === 'string' && fastifyError.message.length > 0
            ? fastifyError.message
            : 'The request was rejected.',
      };
    }
  }

  // A TypeError raised while the SDK serializes the operation input is the
  // caller's fault (e.g. `Invoke` with a numeric `Payload`), not a 500.
  if (error instanceof TypeError) {
    return {
      code: ApiErrorCodes.validationFailed,
      statusCode: 400,
      message: `The operation input could not be serialized (${error.message.slice(0, 200)}).`,
      details: { reason: 'sdk-input-serialization' },
    };
  }

  // Unknown failure: keep the details in the logs, not in the response.
  return {
    code: ApiErrorCodes.internal,
    statusCode: 500,
    message: 'LocalDeck api encountered an unexpected error.',
  };
}

/** Converts anything thrown in a route into a client-shaped ApiProblem. */
export function asApiProblem(error: unknown, context: ErrorContext = {}): ApiProblem {
  if (error instanceof ApiProblem) return error;
  return new ApiProblem({ ...toApiError(error, context), cause: error });
}
