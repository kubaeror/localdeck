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

function toSnapshot(payload: unknown, endpoint: string): LocalStackHealthSnapshot {
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

/**
 * Probes the externally managed LocalStack instance.
 *
 * LocalStack's health document is not an AWS API, so this deliberately uses
 * plain HTTP instead of an AWS SDK client. Never throws a raw error: every
 * failure is turned into an ApiProblem that the Fastify error handler renders
 * as a clean ApiErrorResponse.
 */
export async function probeLocalStackHealth(config: AppConfig): Promise<LocalStackProbeResult> {
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
    snapshot: toSnapshot(payload, config.localstackEndpoint),
    latencyMs: Date.now() - startedAt,
    checkedAt,
  };
}
