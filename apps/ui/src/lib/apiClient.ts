import {
  API_PATHS,
  isApiErrorResponse,
  type ApiConfigResponse,
  type ApiError,
  type HealthResponse,
  type LivenessResponse,
  type ServiceRegistryResponse,
} from '@localdeck/shared';

/**
 * Empty base URL means "same origin": during development Vite proxies /api to
 * the api process, and in the ui container nginx does the same for the api
 * service. Set VITE_API_BASE_URL only when the ui is served from elsewhere.
 */
const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** An error response that already carries the shared ApiError contract. */
export class ApiClientError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiClientError';
    this.apiError = apiError;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiClientError) return error.apiError;
  if (error instanceof Error && error.name === 'TimeoutError') {
    return {
      code: 'REQUEST_TIMEOUT',
      statusCode: 0,
      message:
        'The LocalDeck api did not answer in time. Check that the api process or container is running and responsive.',
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'REQUEST_ABORTED',
      statusCode: 0,
      message: 'The request to the LocalDeck api was cancelled.',
    };
  }
  return {
    code: 'NETWORK_ERROR',
    statusCode: 0,
    message:
      'The LocalDeck ui could not reach the LocalDeck api. Check that the api process or container is running.',
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Default deadline for JSON api calls. */
const JSON_REQUEST_TIMEOUT_MS = 30_000;
/** Deadline for streaming calls (uploads/downloads) that legitimately run long. */
const STREAM_REQUEST_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/**
 * Combines the caller's cancellation signal with a wall-clock deadline. Without
 * a deadline a hung api/proxy leaves every page loading forever.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      signal: withTimeout(signal, JSON_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiClientError(toApiError(error));
  }
  return readResponse<T>(response);
}

/** POST helper used by the dynamic service dispatcher client. */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: withTimeout(signal, JSON_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiClientError(toApiError(error));
  }
  return readResponse<T>(response);
}

/**
 * POSTs one file as `multipart/form-data`; the S3 upload proxy reads it from
 * the request stream. The browser sets the boundary, so no content-type header
 * is added here. Uploads get the long streaming deadline, not the JSON one.
 */
export async function postMultipart<T>(path: string, file: File, signal?: AbortSignal): Promise<T> {
  const body = new FormData();
  body.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json' },
      body,
      signal: withTimeout(signal, STREAM_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiClientError(toApiError(error));
  }
  return readResponse<T>(response);
}

/**
 * Absolute URL of an api path, for same-origin links the browser follows
 * itself (the S3 download proxy). Kept here so only this module builds URLs.
 */
export function apiUrl(path: string): string {
  return `${baseUrl}${path}`;
}

/** Text response plus the file name the api suggested, when it sent one. */
export interface ApiTextResponse {
  text: string;
  /** `filename=` from Content-Disposition, when the api sent the header. */
  fileName?: string;
}

/**
 * Reads the file name out of a Content-Disposition value. RFC 5987
 * `filename*=UTF-8''…` (percent-encoded) wins over the plain
 * `filename="…"`/`filename=…` parameter, as RFC 6266 prescribes.
 */
function parseContentDispositionFileName(value: string | null): string | undefined {
  if (value === null) return undefined;
  const extended = /filename\*\s*=\s*utf-8'[^']*'([^;]+)/i.exec(value)?.[1];
  if (extended !== undefined) {
    try {
      const decoded = decodeURIComponent(extended.trim());
      if (decoded.length > 0) return decoded;
    } catch {
      // Malformed percent-encoding: fall back to the plain filename below.
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1];
  const bare = /filename\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim();
  const name = quoted ?? bare;
  return name === undefined || name.length === 0 ? undefined : name;
}

/**
 * Fetches a non-JSON api response as text (the EKS kubeconfig download). It
 * lives here, next to the JSON helpers, so the architecture guard — only this
 * module may call fetch — holds for every service module.
 */
export async function getText(path: string, signal?: AbortSignal): Promise<ApiTextResponse> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/yaml, text/yaml, text/plain, */*' },
      signal: withTimeout(signal, STREAM_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiClientError(toApiError(error));
  }

  if (!response.ok) {
    const payload = await readJson(response);
    if (isApiErrorResponse(payload)) throw new ApiClientError(payload.error);
    throw new ApiClientError({
      code: 'UNEXPECTED_RESPONSE',
      statusCode: response.status,
      message: `The LocalDeck api responded with HTTP ${response.status} and no ApiError body.`,
    });
  }

  const fileName = parseContentDispositionFileName(response.headers.get('content-disposition'));
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiClientError({
      code: 'UNEXPECTED_RESPONSE',
      statusCode: response.status,
      message: `The LocalDeck api responded with HTTP ${response.status} but the body could not be read.`,
    });
  }
  return {
    text,
    ...(fileName === undefined ? {} : { fileName }),
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await readJson(response);
    if (isApiErrorResponse(payload)) throw new ApiClientError(payload.error);
    throw new ApiClientError({
      code: 'UNEXPECTED_RESPONSE',
      statusCode: response.status,
      message: `The LocalDeck api responded with HTTP ${response.status} and no ApiError body.`,
    });
  }

  // The api is the only producer of these payloads, but a proxy or a truncated
  // response can still hand us a body that is not JSON. That is an api/proxy
  // contract failure, not a network failure, so it must not be reported as
  // "could not reach the LocalDeck api".
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiClientError({
      code: 'UNEXPECTED_RESPONSE',
      statusCode: response.status,
      message: `The LocalDeck api responded with HTTP ${response.status} and a body that is not valid JSON.`,
    });
  }
}

export function getConfig(signal?: AbortSignal): Promise<ApiConfigResponse> {
  return request<ApiConfigResponse>(API_PATHS.config, signal);
}

/**
 * GET /api/health. In Floci Console Contract v1 mode the api answers HTTP 200
 * with `{status: "unavailable"}` while the emulator is down; surface that as
 * the same unreachable state a 503 produces so the console behaves identically.
 */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const payload = await request<HealthResponse | { status: 'unavailable'; error?: string }>(
    API_PATHS.health,
    signal,
  );
  if (payload.status === 'unavailable') {
    throw new ApiClientError({
      code: 'EMULATOR_UNREACHABLE',
      statusCode: 503,
      message: payload.error ?? 'The emulator is not reachable.',
    });
  }
  return payload;
}

export function getLiveness(signal?: AbortSignal): Promise<LivenessResponse> {
  return request<LivenessResponse>(API_PATHS.liveness, signal);
}

/**
 * The service registry as published by the api. The ui keeps a bundled copy so
 * the console renders offline; this call confirms it against the running api.
 */
export function getServices(signal?: AbortSignal): Promise<ServiceRegistryResponse> {
  return request<ServiceRegistryResponse>(API_PATHS.services, signal);
}
