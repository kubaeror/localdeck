import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  detectEmulatorProvider,
  getEmulatorProvider,
  normalizeEmulatorServices,
  readProviderMetadata,
  readReadyState,
  summarizeServiceStates,
  type EmulatorHealthSnapshot,
  type EmulatorProviderDescriptor,
  type EmulatorProviderId,
} from '@localdeck/shared';
import type { AppConfig } from '../config.js';
import { createStsClient } from './awsClients.js';
import {
  describeNetworkFailure,
  EmulatorInvalidResponseProblem,
  EmulatorUnreachableProblem,
  findNetworkErrorCode,
} from './errors.js';

export interface EmulatorProbeResult {
  snapshot: EmulatorHealthSnapshot;
  latencyMs: number;
  checkedAt: string;
}

/** Probe order for auto-detection: most specific paths first. */
const AUTO_PROBE_PATHS = ['/_floci/health', '/_ministack/health', '/_localstack/health', '/health'];

/** Path → provider for paths only one emulator serves. */
const PATH_PROVIDERS: Readonly<Record<string, EmulatorProviderId>> = {
  '/_floci/health': 'floci',
  '/_ministack/health': 'ministack',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Fingerprints one parsed health document. `undefined` means "unrecognized". */
export function detectProviderFromPayload(
  payload: Record<string, unknown>,
): EmulatorProviderDescriptor | undefined {
  return detectEmulatorProvider(payload);
}

/**
 * Parses one emulator health document into the shared snapshot shape.
 * Exported so the parsing edges (missing `services`, unknown statuses,
 * non-object `features`) are unit-testable without an HTTP stub.
 */
export function parseEmulatorHealthDocument(
  payload: unknown,
  provider: EmulatorProviderDescriptor,
  endpoint: string,
): EmulatorHealthSnapshot {
  if (!isRecord(payload)) {
    throw new EmulatorInvalidResponseProblem({
      endpoint,
      reason: 'body is not a JSON object',
      providerLabel: provider.displayName,
    });
  }

  const rawServices = payload['services'];
  if (provider.hasServiceInventory && !isRecord(rawServices)) {
    throw new EmulatorInvalidResponseProblem({
      endpoint,
      reason: 'the "services" property is missing',
      providerLabel: provider.displayName,
    });
  }

  const normalized = normalizeEmulatorServices(
    provider.id,
    provider.normalizeStatus,
    isRecord(rawServices) ? rawServices : {},
  );
  const { version, edition } = readProviderMetadata(payload);
  const features = payload['features'];

  return {
    provider: provider.id,
    providerLabel: provider.displayName,
    version,
    edition,
    hasServiceInventory: provider.hasServiceInventory,
    services: normalized.services,
    rawServices: normalized.rawServices,
    counts: summarizeServiceStates(normalized.services),
    features: isRecord(features) ? { ...features } : {},
    ready: readReadyState(payload),
  };
}

function genericSnapshot(): EmulatorHealthSnapshot {
  const provider = getEmulatorProvider('generic');
  return {
    provider: provider.id,
    providerLabel: provider.displayName,
    version: null,
    edition: null,
    hasServiceInventory: false,
    services: {},
    rawServices: {},
    counts: summarizeServiceStates({}),
    features: {},
    ready: null,
  };
}

interface AttemptFailure {
  path: string;
  status?: number;
  network?: unknown;
  /** True when the path answered 200 with a JSON body we could not classify. */
  malformed?: boolean;
}

function healthUrl(endpoint: string, path: string): string {
  return new URL(path, `${endpoint}/`).toString();
}

/**
 * Reaches any AWS-compatible endpoint that exposes no known health document.
 * STS GetCallerIdentity works across emulators and real AWS; an HTTP error
 * still proves the endpoint is reachable, a network failure does not.
 */
async function probeGenericEndpoint(
  config: AppConfig,
  checkedAt: string,
): Promise<EmulatorProbeResult> {
  const startedAt = Date.now();
  const client = createStsClient({
    endpoint: config.emulatorEndpoint,
    region: config.region,
    connectionTimeoutMs: Math.min(config.emulatorConnectionTimeoutMs, config.emulatorTimeoutMs),
    requestTimeoutMs: config.emulatorTimeoutMs,
  });

  try {
    await client.send(new GetCallerIdentityCommand({}), {
      abortSignal: AbortSignal.timeout(config.emulatorTimeoutMs),
    });
  } catch (error) {
    if (findNetworkErrorCode(error) !== undefined || error instanceof TypeError) {
      throw new EmulatorUnreachableProblem({
        endpoint: config.emulatorEndpoint,
        reason: describeFetchFailure(error, config.emulatorTimeoutMs),
        hint:
          'Set EMULATOR_ENDPOINT to the endpoint your emulator listens on. When the api runs ' +
          'in Docker and the emulator on the Docker host, use http://host.docker.internal:4566 ' +
          '(or docker-compose.loopback.yml for a host-loopback emulator).',
        cause: error,
      });
    }
    // Any HTTP response means the endpoint answered; treat it as reachable but
    // without a service inventory.
  } finally {
    client.destroy();
  }

  return {
    snapshot: genericSnapshot(),
    latencyMs: Date.now() - startedAt,
    checkedAt,
  };
}

async function probeOnce(config: AppConfig): Promise<EmulatorProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const pinned = config.emulatorProvider;
  const failures: AttemptFailure[] = [];

  const candidates: { path: string; provider?: EmulatorProviderDescriptor }[] = [];
  if (pinned === 'generic') {
    return probeGenericEndpoint(config, checkedAt);
  }
  if (pinned === 'auto') {
    candidates.push(...AUTO_PROBE_PATHS.map((path) => ({ path })));
  } else {
    const provider = getEmulatorProvider(pinned);
    candidates.push(...provider.healthPaths.map((path) => ({ path, provider })));
  }

  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetch(healthUrl(config.emulatorEndpoint, candidate.path), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(config.emulatorTimeoutMs),
      });
    } catch (error) {
      failures.push({ path: candidate.path, network: error });
      continue;
    }

    if (!response.ok) {
      failures.push({ path: candidate.path, status: response.status });
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      failures.push({ path: candidate.path, status: response.status, malformed: true });
      continue;
    }

    let provider = candidate.provider;
    if (provider === undefined && isRecord(payload)) {
      const pathProvider = PATH_PROVIDERS[candidate.path];
      provider =
        (pathProvider === undefined ? undefined : getEmulatorProvider(pathProvider)) ??
        detectProviderFromPayload(payload);
      if (provider === undefined && isRecord(payload['services'])) {
        // An unknown emulator with a service inventory: more useful than the
        // generic fallback, but we cannot label it.
        provider = { ...getEmulatorProvider('generic'), hasServiceInventory: true };
      }
    }
    if (provider === undefined || !isRecord(payload)) {
      failures.push({ path: candidate.path, status: response.status, malformed: true });
      continue;
    }

    try {
      return {
        snapshot: parseEmulatorHealthDocument(payload, provider, config.emulatorEndpoint),
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    } catch {
      failures.push({ path: candidate.path, status: response.status, malformed: true });
    }
  }

  const networkFailure = failures.find((failure) => failure.network !== undefined);
  if (networkFailure !== undefined) {
    throw new EmulatorUnreachableProblem({
      endpoint: config.emulatorEndpoint,
      reason: describeFetchFailure(networkFailure.network, config.emulatorTimeoutMs),
      ...(pinned === 'auto' ? {} : { providerLabel: getEmulatorProvider(pinned).displayName }),
      hint:
        'Set EMULATOR_ENDPOINT to the endpoint your emulator listens on. When the api runs ' +
        'in Docker and the emulator on the Docker host, use http://host.docker.internal:4566 ' +
        '(or docker-compose.loopback.yml for a host-loopback emulator).',
      cause: networkFailure.network,
    });
  }

  // No health document matched. An auto-detected endpoint that answered no
  // health path at all still gets the generic treatment (STS probe); a pinned
  // provider or a malformed 200 body is reported as an invalid response
  // instead of silently downgrading to "unknown emulator".
  const sawMalformedBody = failures.some((failure) => failure.malformed === true);
  if (pinned === 'auto' && !sawMalformedBody) {
    try {
      return await probeGenericEndpoint(config, checkedAt);
    } catch (error) {
      if (error instanceof EmulatorUnreachableProblem) throw error;
    }
  }

  const detail =
    pinned === 'auto'
      ? sawMalformedBody
        ? 'the health endpoint answered with a JSON body that does not contain a usable "services" inventory'
        : 'none of the known emulator health endpoints answered with a recognizable health document (/_floci/health, /_ministack/health, /_localstack/health, /health)'
      : `EMULATOR_PROVIDER=${pinned} is pinned, but ${healthUrl(config.emulatorEndpoint, candidates[0]?.path ?? '/')} did not answer with a valid health document`;
  throw new EmulatorInvalidResponseProblem({
    endpoint: config.emulatorEndpoint,
    reason: detail,
    providerLabel:
      pinned === 'auto' ? 'The configured endpoint' : getEmulatorProvider(pinned).displayName,
  });
}

/** Cached probe result: in-flight promise + the instant it stops being reused. */
interface CachedProbe {
  /** Endpoint + pinned provider + timeout the probe was made with. */
  key: string;
  promise: Promise<EmulatorProbeResult>;
  expiresAt: number;
}

let cachedProbe: CachedProbe | undefined;

/** Test hook: forget the cached/single-flight probe. */
export function resetEmulatorHealthCache(): void {
  cachedProbe = undefined;
}

/**
 * Probes the externally managed emulator instance, reusing a successful
 * result for `EMULATOR_HEALTH_CACHE_MS` (default 2s) and collapsing concurrent
 * probes into one upstream request (single-flight). This keeps the
 * unauthenticated `/api/health` route from hammering the emulator when the ui
 * polls from several components.
 *
 * The health document is not an AWS API, so this deliberately uses plain HTTP
 * (with an STS fallback for endpoints without one). Never throws a raw error:
 * every failure becomes an ApiProblem the Fastify error handler renders as a
 * clean ApiErrorResponse.
 */
export async function probeEmulatorHealth(config: AppConfig): Promise<EmulatorProbeResult> {
  const ttl = config.emulatorHealthCacheMs;
  const key = `${config.emulatorEndpoint}|${config.emulatorProvider}|${config.emulatorTimeoutMs}`;
  if (ttl > 0) {
    const now = Date.now();
    if (cachedProbe !== undefined && cachedProbe.key === key && cachedProbe.expiresAt > now) {
      return cachedProbe.promise;
    }
  } else {
    cachedProbe = undefined;
  }

  const promise = probeOnce(config);
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
