import type {
  EmulatorProviderDescriptor,
  EmulatorProviderId,
  EmulatorServiceState,
} from './types.js';

/**
 * Canonical service state merging.
 *
 * One canonical service can be reported under several provider keys (Floci
 * reports `apigateway` and `apigatewayv2`; MiniStack reports `lambda`,
 * `lambda-core` and `lambda-microvms`). The highest-priority state wins so a
 * partially broken provider still surfaces honestly.
 */
const STATE_PRIORITY: Readonly<Record<EmulatorServiceState, number>> = {
  error: 5,
  enabled: 4,
  starting: 3,
  disabled: 2,
  unknown: 1,
};

export function mergeServiceState(
  left: EmulatorServiceState,
  right: EmulatorServiceState,
): EmulatorServiceState {
  return STATE_PRIORITY[left] >= STATE_PRIORITY[right] ? left : right;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** LocalStack: available/running are enabled; the rest map straight through. */
function normalizeLocalStackStatus(raw: unknown): EmulatorServiceState {
  switch (raw) {
    case 'available':
    case 'running':
      return 'enabled';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    case 'disabled':
      return 'disabled';
    default:
      return 'unknown';
  }
}

/**
 * Floci: `running` means enabled, `available` means known but disabled.
 * Do NOT reuse LocalStack's mapping here.
 */
function normalizeFlociStatus(raw: unknown): EmulatorServiceState {
  switch (raw) {
    case 'running':
      return 'enabled';
    case 'available':
      return 'disabled';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    case 'disabled':
      return 'disabled';
    default:
      return 'unknown';
  }
}

/** MiniStack: health only lists enabled handlers, all reported as available. */
function normalizeMiniStackStatus(raw: unknown): EmulatorServiceState {
  switch (raw) {
    case 'available':
      return 'enabled';
    case 'running':
      return 'enabled';
    case 'starting':
      return 'starting';
    case 'error':
      return 'error';
    case 'disabled':
      return 'disabled';
    default:
      return 'unknown';
  }
}

const LOCALSTACK: EmulatorProviderDescriptor = {
  id: 'localstack',
  displayName: 'LocalStack',
  docsUrl: 'https://docs.localstack.cloud/aws/services/',
  healthPaths: ['/_localstack/health'],
  hasServiceInventory: true,
  // LocalStack always reports its feature flags; a bare `services` document
  // without one is handled by the api's "unknown inventory" fallback instead.
  detect: (payload) => 'features' in payload,
  normalizeStatus: normalizeLocalStackStatus,
};

const FLOCI: EmulatorProviderDescriptor = {
  id: 'floci',
  displayName: 'Floci',
  docsUrl: 'https://floci.io/floci/services/',
  healthPaths: ['/_floci/health', '/_localstack/health'],
  hasServiceInventory: true,
  // Floci serves LocalStack's path too (parity mode). The `original_edition`
  // marker survives the edition rename from `floci-always-free` to `community`.
  detect: (payload) => 'original_edition' in payload || payload['edition'] === 'floci-always-free',
  normalizeStatus: normalizeFlociStatus,
};

const MINISTACK: EmulatorProviderDescriptor = {
  id: 'ministack',
  displayName: 'MiniStack',
  docsUrl: 'https://github.com/ministackorg/ministack',
  healthPaths: ['/_ministack/health', '/_localstack/health', '/health'],
  hasServiceInventory: true,
  detect: (payload) => 'ready_scripts' in payload,
  normalizeStatus: normalizeMiniStackStatus,
};

/**
 * Fallback for any AWS-compatible endpoint (Moto, LocalEmu, fakecloud, …):
 * reachability is proven with STS GetCallerIdentity, but there is no service
 * inventory to render, so every service stays "unverified" until it is called.
 */
const GENERIC: EmulatorProviderDescriptor = {
  id: 'generic',
  displayName: 'AWS-compatible endpoint',
  docsUrl: 'https://docs.localstack.cloud/aws/services/',
  healthPaths: [],
  hasServiceInventory: false,
  detect: () => false,
  normalizeStatus: () => 'unknown',
};

export const EMULATOR_PROVIDERS: readonly EmulatorProviderDescriptor[] = [
  LOCALSTACK,
  FLOCI,
  MINISTACK,
  GENERIC,
];

/** Provider ids an operator may pin with EMULATOR_PROVIDER. */
export const EMULATOR_PROVIDER_IDS: readonly EmulatorProviderId[] = [
  'localstack',
  'floci',
  'ministack',
  'generic',
];

const BY_ID = new Map<EmulatorProviderId, EmulatorProviderDescriptor>(
  EMULATOR_PROVIDERS.map((provider) => [provider.id, provider]),
);

export function getEmulatorProvider(id: EmulatorProviderId): EmulatorProviderDescriptor {
  const provider = BY_ID.get(id);
  if (provider === undefined) {
    throw new Error(`Unknown emulator provider "${id}"`);
  }
  return provider;
}

export function isEmulatorProviderId(value: unknown): value is EmulatorProviderId {
  return typeof value === 'string' && (EMULATOR_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Fingerprints one parsed health document. The generic fallback never matches:
 * it is the absence of a recognizable provider, not a fingerprint.
 */
export function detectEmulatorProvider(
  payload: Record<string, unknown>,
): EmulatorProviderDescriptor | undefined {
  return EMULATOR_PROVIDERS.filter((provider) => provider.id !== 'generic').find((provider) =>
    provider.detect(payload),
  );
}

/** Reads a provider's version/edition fields, tolerating missing values. */
export function readProviderMetadata(payload: Record<string, unknown>): {
  version: string | null;
  edition: string | null;
} {
  return {
    version: stringValue(payload['version']),
    edition: stringValue(payload['edition']),
  };
}
