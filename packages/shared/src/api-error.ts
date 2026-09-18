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
  validationFailed: 'VALIDATION_FAILED',
  badGateway: 'BAD_GATEWAY',
  serviceUnavailable: 'SERVICE_UNAVAILABLE',
  localstackUnreachable: 'LOCALSTACK_UNREACHABLE',
  localstackInvalidResponse: 'LOCALSTACK_INVALID_RESPONSE',
  awsSdkError: 'AWS_SDK_ERROR',
  /** The operation exists in AWS but is not on the service's whitelist. */
  operationNotWhitelisted: 'OPERATION_NOT_WHITELISTED',
  /** No LocalDeck service is registered for the requested service id. */
  serviceNotRegistered: 'SERVICE_NOT_REGISTERED',
  /** The api does not have the service's AWS SDK package installed. */
  sdkPackageUnavailable: 'SDK_PACKAGE_UNAVAILABLE',
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes];

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
