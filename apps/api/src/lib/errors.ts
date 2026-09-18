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

/** LocalStack could not be reached at all (stopped, wrong host/port, timeout). */
export class LocalStackUnreachableProblem extends ApiProblem {
  constructor(args: { endpoint: string; reason: string; hint?: string; cause?: unknown }) {
    super({
      code: ApiErrorCodes.localstackUnreachable,
      statusCode: 503,
      message:
        `LocalDeck api is running, but LocalStack is unreachable at ${args.endpoint} ` +
        `(${args.reason}). Start LocalStack, or point LOCALSTACK_ENDPOINT at the ` +
        'instance you want this console to manage.',
      details: {
        endpoint: args.endpoint,
        reason: args.reason,
        ...(args.hint === undefined ? {} : { hint: args.hint }),
      },
      cause: args.cause,
    });
  }
}

/** LocalStack answered, but not with a health document we understand. */
export class LocalStackInvalidResponseProblem extends ApiProblem {
  constructor(args: { endpoint: string; reason: string; cause?: unknown }) {
    super({
      code: ApiErrorCodes.localstackInvalidResponse,
      statusCode: 502,
      message: `LocalStack at ${args.endpoint} returned an unexpected health response (${args.reason}).`,
      details: { endpoint: args.endpoint, reason: args.reason },
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

const NETWORK_ERROR_NAMES = new Set(['TimeoutError', 'AbortError', 'ConnectTimeoutError']);

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

interface AwsSdkErrorLike {
  name: string;
  message: string;
  httpStatusCode: number | undefined;
  requestId: string | undefined;
  service: string | undefined;
}

function asAwsSdkError(error: unknown): AwsSdkErrorLike | null {
  if (!(error instanceof Error)) return null;
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
  // 4xx from LocalStack is the caller's problem; 5xx is an upstream failure.
  const statusCode = upstream >= 400 && upstream < 500 ? upstream : 502;
  const apiError: ApiError = {
    code: error.name.length > 0 ? error.name : ApiErrorCodes.awsSdkError,
    message: error.message.length > 0 ? error.message : `AWS SDK call failed with ${error.name}.`,
    statusCode,
  };
  if (error.requestId !== undefined) apiError.requestId = error.requestId;
  if (error.service !== undefined) apiError.service = error.service;
  apiError.details = {
    upstreamStatusCode: upstream,
    ...(context.endpoint === undefined ? {} : { endpoint: context.endpoint }),
  };
  return apiError;
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
    code: 'PAYLOAD_TOO_LARGE',
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
  }

  const networkCode = findNetworkErrorCode(error);
  if (networkCode !== undefined) {
    const endpoint = context.endpoint ?? 'the configured LocalStack endpoint';
    return {
      code: ApiErrorCodes.localstackUnreachable,
      statusCode: 503,
      message:
        `LocalDeck api is running, but LocalStack is unreachable at ${endpoint} (${networkCode}). ` +
        'Start LocalStack, or point LOCALSTACK_ENDPOINT at the instance you want to manage.',
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

  // Unknown failure: keep the details in the logs, not in the response.
  return {
    code: ApiErrorCodes.internal,
    statusCode: 500,
    message: 'LocalDeck api encountered an unexpected error.',
  };
}
