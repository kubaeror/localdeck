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

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
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
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    throw new ApiClientError(toApiError(error));
  }
  return readResponse<T>(response);
}

/**
 * POSTs one file as `multipart/form-data`; the S3 upload proxy reads it from
 * the request stream. The browser sets the boundary, so no content-type header
 * is added here.
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
      ...(signal === undefined ? {} : { signal }),
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

/** Reads `filename="…"` (or `filename=…`) out of a Content-Disposition value. */
function parseContentDispositionFileName(value: string | null): string | undefined {
  if (value === null) return undefined;
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
      ...(signal === undefined ? {} : { signal }),
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
  return {
    text: await response.text(),
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

  // The api is the only producer of these payloads; responses are trusted.
  return (await response.json()) as T;
}

export function getConfig(signal?: AbortSignal): Promise<ApiConfigResponse> {
  return request<ApiConfigResponse>(API_PATHS.config, signal);
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>(API_PATHS.health, signal);
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
