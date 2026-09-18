/**
 * Every LocalDeck api failure — validation problems, AWS SDK failures and an
 * unreachable LocalStack alike — is returned to the browser in this shape so
 * the ui can render a consistent error state instead of a raw stack trace.
 */
export interface ApiError {
  /** Stable, machine-readable code, e.g. LOCALSTACK_UNREACHABLE. */
  code: string;
  /** Human-readable, safe-to-display message (never contains credentials). */
  message: string;
  /** HTTP status code that was sent to the client. */
  statusCode: number;
  /** AWS request id when the failure originated from an AWS SDK call. */
  requestId?: string;
  /** AWS service namespace when the failure originated from an AWS SDK call. */
  service?: string;
  /** Non-sensitive structured context, e.g. the endpoint that was probed. */
  details?: Record<string, unknown>;
}

/** Response body of every non-2xx LocalDeck api response. */
export interface ApiErrorResponse {
  error: ApiError;
}

/** Codes emitted by the LocalDeck api itself (AWS codes are passed through). */
export const ApiErrorCodes = {
  internal: 'INTERNAL_ERROR',
  notFound: 'NOT_FOUND',
  /** The path exists, but not for the request method. */
  methodNotAllowed: 'METHOD_NOT_ALLOWED',
  validationFailed: 'VALIDATION_FAILED',
  badGateway: 'BAD_GATEWAY',
  localstackUnreachable: 'LOCALSTACK_UNREACHABLE',
  localstackInvalidResponse: 'LOCALSTACK_INVALID_RESPONSE',
  /** LocalStack accepted the connection but did not answer in time. */
  localstackTimeout: 'LOCALSTACK_TIMEOUT',
  /** The caller went away (or Fastify's handler timeout aborted the request). */
  requestAborted: 'REQUEST_ABORTED',
  awsSdkError: 'AWS_SDK_ERROR',
  /** The operation exists in AWS but is not on the service's whitelist. */
  operationNotWhitelisted: 'OPERATION_NOT_WHITELISTED',
  /** No LocalDeck service is registered for the requested service id. */
  serviceNotRegistered: 'SERVICE_NOT_REGISTERED',
  /** The api does not have the service's AWS SDK package installed. */
  sdkPackageUnavailable: 'SDK_PACKAGE_UNAVAILABLE',
  /** The service is registered as a placeholder and exposes no operations. */
  servicePlanned: 'SERVICE_PLANNED',
  /** The operation returned a stream/blob the JSON dispatcher cannot carry. */
  binaryResponseUnsupported: 'BINARY_RESPONSE_UNSUPPORTED',
  /** The EKS cluster is not ACTIVE yet, so a kubeconfig cannot be built. */
  clusterNotReady: 'CLUSTER_NOT_READY',
  /** A multipart upload exceeded the 5 GiB single-object limit. */
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
} as const;

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.statusCode === 'number'
  );
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  return isApiError((value as Record<string, unknown>).error);
}
