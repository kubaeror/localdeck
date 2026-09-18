/**
 * Service lifecycle states reported by GET ${LOCALSTACK_ENDPOINT}/_localstack/health.
 * These are LocalStack's own states — not AWS resource states.
 */
export type LocalStackServiceStatus =
  'available' | 'running' | 'starting' | 'error' | 'disabled' | 'unknown';

/** LocalStack's health endpoint path (LocalStack-specific, not an AWS API). */
export const LOCALSTACK_HEALTH_PATH = '/_localstack/health';

export function normalizeLocalStackServiceStatus(value: unknown): LocalStackServiceStatus {
  switch (value) {
    case 'available':
    case 'running':
    case 'starting':
    case 'error':
    case 'disabled':
    case 'unknown':
      return value;
    default:
      return 'unknown';
  }
}

export interface ServiceAvailabilityCounts {
  total: number;
  available: number;
  error: number;
  /** Services that are neither available nor errored (starting/disabled/unknown). */
  other: number;
}

export function summarizeServiceAvailability(
  services: Readonly<Record<string, LocalStackServiceStatus>>,
): ServiceAvailabilityCounts {
  let available = 0;
  let error = 0;
  let other = 0;

  for (const status of Object.values(services)) {
    // 'running' is a legacy LocalStack status for a service that is up.
    if (status === 'available' || status === 'running') available += 1;
    else if (status === 'error') error += 1;
    else other += 1;
  }

  return { total: available + error + other, available, error, other };
}

/** Normalized snapshot of the external LocalStack instance. */
export interface LocalStackHealthSnapshot {
  version: string | null;
  edition: string | null;
  services: Record<string, LocalStackServiceStatus>;
  features: Record<string, unknown>;
  counts: ServiceAvailabilityCounts;
}

/** GET /api/health — 200 when LocalStack answered, 503 (ApiErrorResponse) when not. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  latencyMs: number;
  endpoint: string;
  region: string;
  localstack: LocalStackHealthSnapshot;
}

/** GET /api/health/live — process liveness, independent of LocalStack. */
export interface LivenessResponse {
  status: 'ok';
  checkedAt: string;
  uptimeSeconds: number;
}

/** GET /api/config — effective, env-driven configuration surfaced to the ui. */
export interface ApiConfigResponse {
  application: {
    name: string;
    version: string;
    environment: string;
  };
  localstack: {
    endpoint: string;
    region: string;
    healthPath: string;
  };
  ui: {
    statusPollIntervalMs: number;
  };
}
