/**
 * LocalDeck can talk to any local AWS emulator, not only LocalStack. A provider
 * descriptor tells the api and the ui how to identify one, where its health
 * endpoint lives and how its status vocabulary maps onto LocalDeck's canonical
 * service states.
 */
export type EmulatorProviderId = 'localstack' | 'floci' | 'ministack' | 'generic';

/**
 * Canonical service state. Every provider reports something different:
 *
 * - LocalStack: `available` / `running` mean enabled.
 * - MiniStack: `available` means enabled (health only lists enabled services).
 * - Floci: `running` means enabled and `available` means *disabled* — the exact
 *   opposite of LocalStack's wording, which is why normalization is per-provider.
 */
export type EmulatorServiceState = 'enabled' | 'disabled' | 'starting' | 'error' | 'unknown';

/** Readiness reported by providers that run init scripts (MiniStack). */
export interface EmulatorReadyState {
  status: 'pending' | 'running' | 'completed' | 'unknown';
  total: number;
  completed: number;
  failed: number;
}

export interface ServiceAvailabilityCounts {
  total: number;
  enabled: number;
  disabled: number;
  error: number;
  /** Services that are starting or reported with an unrecognized state. */
  other: number;
}

/** Identity of the emulator a response came from, as served over HTTP. */
export interface EmulatorProviderSummary {
  provider: EmulatorProviderId;
  providerLabel: string;
  version: string | null;
  edition: string | null;
  /** Provider's service documentation index, for "API coverage" links. */
  docsUrl: string;
}

/** Normalized snapshot of the active local emulator instance. */
export interface EmulatorHealthSnapshot {
  provider: EmulatorProviderId;
  providerLabel: string;
  version: string | null;
  edition: string | null;
  /** False for the generic fallback: no service inventory was reported. */
  hasServiceInventory: boolean;
  /** Canonical registry id → merged state. */
  services: Record<string, EmulatorServiceState>;
  /** Raw provider key → normalized state (drives the coverage panel). */
  rawServices: Record<string, EmulatorServiceState>;
  counts: ServiceAvailabilityCounts;
  features: Record<string, unknown>;
  ready: EmulatorReadyState | null;
}

export interface EmulatorProviderDescriptor {
  id: EmulatorProviderId;
  /** Product name shown in the console ("LocalStack", "MiniStack", "Floci"). */
  displayName: string;
  /** Where a failed action can explain the provider's own limitations. */
  docsUrl: string;
  /** Health endpoints to probe, most specific first. */
  healthPaths: readonly string[];
  /**
   * False for the generic fallback: the endpoint passes the AWS probe but
   * exposes no service inventory, so the ui must not grey services out.
   */
  hasServiceInventory: boolean;
  /** True when the health document identifies this provider. */
  detect(payload: Record<string, unknown>): boolean;
  /** Maps one raw status value onto the canonical state. */
  normalizeStatus(raw: unknown): EmulatorServiceState;
}
