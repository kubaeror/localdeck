import {
  normalizeLocalStackServiceStatus,
  summarizeServiceAvailability,
  type LocalStackHealthSnapshot,
  type LocalStackServiceStatus,
} from '@localdeck/shared';
import type { AppConfig } from '../config.js';
import {
  describeNetworkFailure,
  LocalStackInvalidResponseProblem,
  LocalStackUnreachableProblem,
} from './errors.js';

export interface LocalStackProbeResult {
  snapshot: LocalStackHealthSnapshot;
  latencyMs: number;
  checkedAt: string;
}

function describeFetchFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return `no response within ${timeoutMs} ms`;
    const detail = describeNetworkFailure(error);
    if (detail !== undefined) return detail;
    return error.message.length > 0 ? error.message : error.name;
  }
  return 'unknown network error';
}

/**
 * Parses one LocalStack health document into the shared snapshot shape.
 * Exported so the parsing edges (missing `services`, unknown statuses,
 * non-object `features`) are unit-testable without an HTTP stub.
 */
export function parseLocalStackHealthSnapshot(
  payload: unknown,
  endpoint: string,
): LocalStackHealthSnapshot {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new LocalStackInvalidResponseProblem({ endpoint, reason: 'body is not a JSON object' });
  }
  const record = payload as Record<string, unknown>;

  const rawServices = record.services;
  if (typeof rawServices !== 'object' || rawServices === null || Array.isArray(rawServices)) {
    throw new LocalStackInvalidResponseProblem({
      endpoint,
      reason: 'the "services" property is missing',
    });
  }

  const services: Record<string, LocalStackServiceStatus> = {};
  for (const [name, status] of Object.entries(rawServices)) {
    services[name] = normalizeLocalStackServiceStatus(status);
  }

  const features = record.features;
  const version = record.version;
  const edition = record.edition;

  return {
    version: typeof version === 'string' ? version : null,
    edition: typeof edition === 'string' ? edition : null,
    services,
    features:
      typeof features === 'object' && features !== null && !Array.isArray(features)
        ? { ...(features as Record<string, unknown>) }
        : {},
    counts: summarizeServiceAvailability(services),
  };
}

/** Cached probe result: in-flight promise + the instant it stops being reused. */
interface CachedProbe {
  /** Endpoint + timeout the probe was made with. */
  key: string;
  promise: Promise<LocalStackProbeResult>;
  expiresAt: number;
}

let cachedProbe: CachedProbe | undefined;

/** Test hook: forget the cached/single-flight probe. */
export function resetLocalStackHealthCache(): void {
  cachedProbe = undefined;
}

async function probeLocalStackHealthOnce(config: AppConfig): Promise<LocalStackProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();

  let response: Response;
  try {
    response = await fetch(config.localstackHealthUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.localstackTimeoutMs),
    });
  } catch (error) {
    throw new LocalStackUnreachableProblem({
      endpoint: config.localstackEndpoint,
      reason: describeFetchFailure(error, config.localstackTimeoutMs),
      hint:
        'When the api runs in Docker and LocalStack runs on the Docker host, set ' +
        'LOCALSTACK_ENDPOINT=http://host.docker.internal:4566 (or use ' +
        'docker-compose.loopback.yml if LocalStack is published on the host loopback).',
      cause: error,
    });
  }

  if (!response.ok) {
    throw new LocalStackUnreachableProblem({
      endpoint: config.localstackEndpoint,
      reason: `health endpoint responded with HTTP ${response.status}`,
      hint: 'LocalStack is reachable but not serving its health document; it may still be starting up.',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new LocalStackInvalidResponseProblem({
      endpoint: config.localstackEndpoint,
      reason: 'body is not valid JSON',
      cause: error,
    });
  }

  return {
    snapshot: parseLocalStackHealthSnapshot(payload, config.localstackEndpoint),
    latencyMs: Date.now() - startedAt,
    checkedAt,
  };
}

/**
 * Probes the externally managed LocalStack instance, reusing a successful
 * result for `LOCALSTACK_HEALTH_CACHE_MS` (default 2s) and collapsing
 * concurrent probes into one upstream request (single-flight). This keeps the
 * unauthenticated `/api/health` route from hammering LocalStack when the ui
 * polls from several components.
 *
 * LocalStack's health document is not an AWS API, so this deliberately uses
 * plain HTTP instead of an AWS SDK client. Never throws a raw error: every
 * failure is turned into an ApiProblem that the Fastify error handler renders
 * as a clean ApiErrorResponse.
 */
export async function probeLocalStackHealth(config: AppConfig): Promise<LocalStackProbeResult> {
  const ttl = config.localstackHealthCacheMs;
  // The cache is keyed by endpoint+timeout: a process can host more than one
  // app (tests, verification scripts), and a probe for one LocalStack must
  // never answer for another.
  const key = `${config.localstackEndpoint}|${config.localstackTimeoutMs}`;
  if (ttl > 0) {
    const now = Date.now();
    if (cachedProbe !== undefined && cachedProbe.key === key && cachedProbe.expiresAt > now) {
      return cachedProbe.promise;
    }
  } else {
    cachedProbe = undefined;
  }

  const promise = probeLocalStackHealthOnce(config);
  if (ttl > 0) {
    const entry: CachedProbe = { key, promise, expiresAt: Date.now() + ttl };
    cachedProbe = entry;
    // A failed probe must never be reused.
    promise.catch(() => {
      if (cachedProbe === entry) cachedProbe = undefined;
    });
  }
  return promise;
}
