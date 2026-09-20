import { readFileSync } from 'node:fs';
import {
  EMULATOR_PROVIDER_IDS,
  isEmulatorProviderId,
  type EmulatorProviderId,
} from '@localdeck/shared';

/**
 * Effective LocalDeck api configuration. Everything is env-driven: the local
 * emulator (LocalStack, MiniStack, Floci, …) is managed outside this project,
 * so its endpoint must never be hardcoded outside of these defaults.
 */
export interface AppConfig {
  applicationName: string;
  version: string;
  environment: string;
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: string;
  logPretty: boolean;
  /**
   * `false` disables cross-origin access (the bundled ui is same-origin through
   * nginx), `true` reflects the caller's origin (CORS_ORIGIN=*) and an array is
   * a fixed allow-list.
   */
  corsOrigin: false | true | string[];
  /** Normalized, no trailing slash, e.g. http://localhost:4566 */
  emulatorEndpoint: string;
  /**
   * Pinned provider id, or `auto` to fingerprint the health document. The
   * generic fallback is also `auto` when no health endpoint answers.
   */
  emulatorProvider: EmulatorProviderId | 'auto';
  /**
   * Endpoint written into generated client artifacts (the EKS kubeconfig).
   * Never used for api→emulator traffic: when the api runs in Docker the
   * internal endpoint (`host.docker.internal`) is not resolvable from the
   * machine where kubectl runs, so a public endpoint can override it.
   * Falls back to `emulatorEndpoint`.
   */
  emulatorPublicEndpoint: string;
  region: string;
  /** Per-request timeout for emulator health probes. */
  emulatorTimeoutMs: number;
  /** TCP connect timeout for AWS SDK calls against the emulator. */
  emulatorConnectionTimeoutMs: number;
  /** Whole-request timeout for AWS SDK calls against the emulator. */
  emulatorRequestTimeoutMs: number;
  /** How long a successful health probe is reused (0 disables the cache). */
  emulatorHealthCacheMs: number;
  /** How long a graceful shutdown may drain before the process is forced out. */
  shutdownTimeoutMs: number;
  /** How often the ui should refresh the status widget. */
  statusPollIntervalMs: number;
  /**
   * Requests per client IP allowed per `rateLimitWindowMs` on `/api/*` routes.
   * 0 disables the limiter entirely (the api is an unauthenticated management
   * proxy, so the default is generous but bounded).
   */
  rateLimitMax: number;
  /** Window the rate limit is measured over, in milliseconds. */
  rateLimitWindowMs: number;
  /**
   * Largest serialized dispatcher response LocalDeck will send to the browser.
   * A runaway list operation (an unfiltered scan) would otherwise buffer
   * hundreds of megabytes into the tab; the cap turns that into a clean 502.
   */
  dispatcherMaxResponseBytes: number;
  /**
   * Floci Console Contract v1 mode: unreachable emulators answer
   * `200 {status:"unavailable"}` instead of `503` on `/api/health`, which is
   * what the Floci sidecar supervisor polls before redirecting the browser.
   */
  consoleContractMode: boolean;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

const DEFAULTS = {
  applicationName: 'LocalDeck',
  environment: 'development',
  host: '0.0.0.0',
  port: 3001,
  logLevel: 'info',
  emulatorEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  emulatorTimeoutMs: 5_000,
  emulatorConnectionTimeoutMs: 5_000,
  emulatorRequestTimeoutMs: 30_000,
  emulatorHealthCacheMs: 2_000,
  shutdownTimeoutMs: 10_000,
  statusPollIntervalMs: 15_000,
  rateLimitMax: 1_200,
  rateLimitWindowMs: 60_000,
  dispatcherMaxResponseBytes: 16 * 1024 * 1024,
} as const;

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** First defined, non-empty environment variable from an ordered alias list. */
function readFirstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readEnv(env, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseIntEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = readEnv(env, key);
  if (raw === undefined) return fallback;
  // `Number` rejects trailing garbage ("3001abc") that parseInt would accept.
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new ConfigurationError(
      `${key} must be an integer between ${bounds.min} and ${bounds.max}, received "${raw}"`,
    );
  }
  return parsed;
}

/** Reads the first alias that parses, so EMULATOR_* wins over LOCALSTACK_*. */
function parseIntEnvAliases(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
  fallback: number,
  bounds: { min: number; max: number },
): number {
  for (const key of keys) {
    if (readEnv(env, key) !== undefined) return parseIntEnv(env, key, fallback, bounds);
  }
  return fallback;
}

function parseBooleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readEnv(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigurationError(`${key} must be a boolean, received "${raw}"`);
}

function normalizeEndpoint(_env: NodeJS.ProcessEnv, raw: string, key: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigurationError(`${key} is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigurationError(`${key} must use http or https, received "${url.protocol}"`);
  }
  if (url.hostname.length === 0) {
    throw new ConfigurationError(`${key} must include a host, received "${raw}"`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    // Credentials in the endpoint would be echoed by /api/config, health
    // errors and logs; refuse them instead.
    throw new ConfigurationError(
      `${key} must not contain credentials (user:password@); pass AWS_ACCESS_KEY_ID / ` +
        'AWS_SECRET_ACCESS_KEY instead.',
    );
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ConfigurationError(
      `${key} must not contain a query string or fragment, received "${raw}"`,
    );
  }
  return url.toString().replace(/\/+$/, '');
}

function parseCorsOrigin(raw: string | undefined): false | true | string[] {
  if (raw === undefined) return false;
  if (raw === '*') return true;
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) return false;
  return origins;
}

function parseLogLevel(raw: string | undefined): string {
  const level = (raw ?? DEFAULTS.logLevel).toLowerCase();
  if (!LOG_LEVELS.has(level)) {
    throw new ConfigurationError(
      `LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}, received "${raw}"`,
    );
  }
  return level;
}

function parseProvider(raw: string | undefined): EmulatorProviderId | 'auto' {
  if (raw === undefined || raw === 'auto') return 'auto';
  const normalized = raw.toLowerCase();
  if (isEmulatorProviderId(normalized)) return normalized;
  throw new ConfigurationError(
    `EMULATOR_PROVIDER must be auto or one of ${EMULATOR_PROVIDER_IDS.join(', ')}, received "${raw}"`,
  );
}

function readPackageVersion(env: NodeJS.ProcessEnv): string {
  // Release images stamp the git tag as APP_VERSION; it wins over the static
  // package.json version so /api/config reports the deployed build.
  const stamped = readEnv(env, 'APP_VERSION');
  if (stamped !== undefined) return stamped;
  try {
    const packageJson = new URL('../package.json', import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const version = (parsed as Record<string, unknown>).version;
      if (typeof version === 'string' && version.length > 0) return version;
    }
  } catch {
    // A missing/unreadable package.json must not prevent the api from booting.
  }
  return '0.0.0';
}

/** Effective endpoint: EMULATOR_ENDPOINT > AWS_ENDPOINT_URL > LOCALSTACK_ENDPOINT. */
export function resolveEmulatorEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = readFirstEnv(env, ['EMULATOR_ENDPOINT', 'AWS_ENDPOINT_URL', 'LOCALSTACK_ENDPOINT']);
  return normalizeEndpoint(
    env,
    raw ?? DEFAULTS.emulatorEndpoint,
    raw === undefined ? 'EMULATOR_ENDPOINT (default)' : endpointKeyFor(env, raw),
  );
}

function endpointKeyFor(env: NodeJS.ProcessEnv, raw: string): string {
  if (readEnv(env, 'EMULATOR_ENDPOINT') === raw) return 'EMULATOR_ENDPOINT';
  if (readEnv(env, 'AWS_ENDPOINT_URL') === raw) return 'AWS_ENDPOINT_URL';
  return 'LOCALSTACK_ENDPOINT';
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const endpoint = resolveEmulatorEndpoint(env);
  const publicEndpointRaw = readFirstEnv(env, [
    'EMULATOR_PUBLIC_ENDPOINT',
    'LOCALSTACK_PUBLIC_ENDPOINT',
  ]);
  const environment = readEnv(env, 'NODE_ENV') ?? DEFAULTS.environment;
  const isProduction = environment === 'production';

  return {
    applicationName: DEFAULTS.applicationName,
    version: readPackageVersion(env),
    environment,
    isProduction,
    host: readEnv(env, 'HOST') ?? DEFAULTS.host,
    port: parseIntEnv(env, 'PORT', DEFAULTS.port, { min: 1, max: 65_535 }),
    logLevel: parseLogLevel(readEnv(env, 'LOG_LEVEL')),
    // A production image has no pino-pretty (devDependency); forcing pretty
    // logging off there keeps LOG_PRETTY=true from breaking startup.
    logPretty: !isProduction && parseBooleanEnv(env, 'LOG_PRETTY', true),
    corsOrigin: parseCorsOrigin(readEnv(env, 'CORS_ORIGIN')),
    emulatorEndpoint: endpoint,
    emulatorProvider: parseProvider(readEnv(env, 'EMULATOR_PROVIDER')),
    emulatorPublicEndpoint:
      publicEndpointRaw === undefined
        ? endpoint
        : normalizeEndpoint(env, publicEndpointRaw, 'EMULATOR_PUBLIC_ENDPOINT'),
    region: readEnv(env, 'AWS_REGION') ?? DEFAULTS.region,
    emulatorTimeoutMs: parseIntEnvAliases(
      env,
      ['EMULATOR_TIMEOUT_MS', 'LOCALSTACK_TIMEOUT_MS'],
      DEFAULTS.emulatorTimeoutMs,
      { min: 100, max: 120_000 },
    ),
    emulatorConnectionTimeoutMs: parseIntEnvAliases(
      env,
      ['EMULATOR_CONNECTION_TIMEOUT_MS', 'LOCALSTACK_CONNECTION_TIMEOUT_MS'],
      DEFAULTS.emulatorConnectionTimeoutMs,
      { min: 100, max: 120_000 },
    ),
    emulatorRequestTimeoutMs: parseIntEnvAliases(
      env,
      ['EMULATOR_REQUEST_TIMEOUT_MS', 'LOCALSTACK_REQUEST_TIMEOUT_MS'],
      DEFAULTS.emulatorRequestTimeoutMs,
      { min: 100, max: 600_000 },
    ),
    emulatorHealthCacheMs: parseIntEnvAliases(
      env,
      ['EMULATOR_HEALTH_CACHE_MS', 'LOCALSTACK_HEALTH_CACHE_MS'],
      DEFAULTS.emulatorHealthCacheMs,
      { min: 0, max: 60_000 },
    ),
    shutdownTimeoutMs: parseIntEnv(env, 'SHUTDOWN_TIMEOUT_MS', DEFAULTS.shutdownTimeoutMs, {
      min: 1_000,
      max: 120_000,
    }),
    statusPollIntervalMs: parseIntEnv(
      env,
      'UI_STATUS_POLL_INTERVAL_MS',
      DEFAULTS.statusPollIntervalMs,
      { min: 1_000, max: 600_000 },
    ),
    rateLimitMax: parseIntEnv(env, 'RATE_LIMIT_MAX', DEFAULTS.rateLimitMax, {
      // 0 disables the limiter (RATE_LIMIT_MAX=0) for operators who front the
      // api with their own gateway.
      min: 0,
      max: 1_000_000,
    }),
    rateLimitWindowMs: parseIntEnv(env, 'RATE_LIMIT_WINDOW_MS', DEFAULTS.rateLimitWindowMs, {
      min: 1_000,
      max: 3_600_000,
    }),
    dispatcherMaxResponseBytes: parseIntEnv(
      env,
      'DISPATCHER_MAX_RESPONSE_BYTES',
      DEFAULTS.dispatcherMaxResponseBytes,
      { min: 64 * 1024, max: 512 * 1024 * 1024 },
    ),
    consoleContractMode: parseBooleanEnv(env, 'LOCALDECK_CONSOLE_CONTRACT', false),
  };
}

let cachedConfig: AppConfig | undefined;

/** Process-wide configuration, parsed once on first use. */
export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = undefined;
}
