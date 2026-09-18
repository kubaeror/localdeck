import type {
  EmulatorHealthSnapshot,
  EmulatorProviderId,
  EmulatorProviderSummary,
} from './providers/index.js';

export type {
  EmulatorHealthSnapshot,
  EmulatorProviderDescriptor,
  EmulatorProviderId,
  EmulatorProviderSummary,
  EmulatorReadyState,
  EmulatorServiceState,
  ServiceAvailabilityCounts,
} from './providers/index.js';
export {
  EMULATOR_PROVIDERS,
  EMULATOR_PROVIDER_IDS,
  getEmulatorProvider,
  isEmulatorProviderId,
  readProviderMetadata,
  summarizeServiceStates,
} from './providers/index.js';

/**
 * LocalStack's health endpoint. Kept because LocalStack deployments and older
 * integrations reference it; new code should use the provider descriptors,
 * which probe `/_floci/health`, `/_ministack/health` and `/_localstack/health`.
 */
export const LOCALSTACK_HEALTH_PATH = '/_localstack/health';

/** GET /api/health — 200 when the emulator answered, 503 (ApiErrorResponse) when not. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  latencyMs: number;
  endpoint: string;
  region: string;
  /** Which local emulator answered, and its self-reported metadata. */
  provider: EmulatorProviderSummary;
  emulator: EmulatorHealthSnapshot;
}

/** GET /api/health/live — process liveness, independent of the emulator. */
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
  emulator: {
    /** Pinned provider id, or `auto` when detection runs against /api/health. */
    provider: EmulatorProviderId | 'auto';
    providerLabel: string;
    endpoint: string;
    /** Host-reachable endpoint used in generated client artifacts (kubeconfig, CLI hints). */
    publicEndpoint: string;
    region: string;
    /** Health paths probed for the active configuration. */
    healthPaths: readonly string[];
  };
  ui: {
    statusPollIntervalMs: number;
  };
}

/**
 * Floci Console Contract v1 (`GET /api/health` shape) used when LocalDeck runs
 * as a Floci-managed sidecar. It is additive: the rich HealthResponse fields
 * stay present, so the LocalDeck ui keeps working in contract mode.
 */
export interface ConsoleContractHealthResponse extends HealthResponse {
  endpoint: string;
  error: null;
  console: { name: string; version: string };
}

/**
 * Floci Console Contract v1 "not ready" answer: HTTP 200 with
 * `status: "unavailable"`, so the supervisor keeps the interstitial page up
 * and shows the error instead of treating the console as dead.
 */
export interface ConsoleContractUnavailableResponse {
  status: 'unavailable';
  endpoint: string;
  error: string;
  console: { name: string; version: string };
}

export type ConsoleContractResponse =
  ConsoleContractHealthResponse | ConsoleContractUnavailableResponse;
