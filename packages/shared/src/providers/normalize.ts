import { canonicalServiceId } from './aliases.js';
import { mergeServiceState } from './providers.js';
import type {
  EmulatorProviderId,
  EmulatorReadyState,
  EmulatorServiceState,
  ServiceAvailabilityCounts,
} from './types.js';

export interface NormalizedEmulatorServices {
  /** Canonical registry id → merged state. */
  services: Record<string, EmulatorServiceState>;
  /** Raw provider key → normalized state, for coverage/unregistered reporting. */
  rawServices: Record<string, EmulatorServiceState>;
}

/**
 * Normalizes one provider health document's `services` map into canonical
 * states. Multiple provider keys can feed one canonical service (Floci reports
 * `apigateway` and `apigatewayv2`), and the highest-priority state wins.
 */
export function normalizeEmulatorServices(
  provider: EmulatorProviderId,
  normalizeStatus: (raw: unknown) => EmulatorServiceState,
  rawServices: Readonly<Record<string, unknown>>,
): NormalizedEmulatorServices {
  const services: Record<string, EmulatorServiceState> = {};
  const rawServicesNormalized: Record<string, EmulatorServiceState> = {};

  for (const [providerKey, rawStatus] of Object.entries(rawServices)) {
    const state = normalizeStatus(rawStatus);
    rawServicesNormalized[providerKey] = state;
    const canonicalId = canonicalServiceId(provider, providerKey);
    const existing = services[canonicalId];
    services[canonicalId] = existing === undefined ? state : mergeServiceState(existing, state);
  }

  return { services, rawServices: rawServicesNormalized };
}

export function summarizeServiceStates(
  services: Readonly<Record<string, EmulatorServiceState>>,
): ServiceAvailabilityCounts {
  let enabled = 0;
  let disabled = 0;
  let error = 0;
  let other = 0;

  for (const state of Object.values(services)) {
    if (state === 'enabled') enabled += 1;
    else if (state === 'disabled') disabled += 1;
    else if (state === 'error') error += 1;
    else other += 1;
  }

  return { total: enabled + disabled + error + other, enabled, disabled, error, other };
}

/**
 * MiniStack reports the execution state of its `ready.d` init scripts. Other
 * providers do not, so they answer `null`.
 */
export function readReadyState(
  payload: Readonly<Record<string, unknown>>,
): EmulatorReadyState | null {
  const raw = payload['ready_scripts'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const status = record['status'];
  const total = record['total'];
  const completed = record['completed'];
  const failed = record['failed'];
  return {
    status:
      status === 'pending' || status === 'running' || status === 'completed' ? status : 'unknown',
    total: typeof total === 'number' ? total : 0,
    completed: typeof completed === 'number' ? completed : 0,
    failed: typeof failed === 'number' ? failed : 0,
  };
}
