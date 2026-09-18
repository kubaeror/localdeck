import { readFileSync } from 'node:fs';
import { LOCALSTACK_HEALTH_PATH } from '@localdeck/shared';

/**
 * Effective LocalDeck api configuration. Everything is env-driven: LocalStack
 * is managed outside this project, so its endpoint must never be hardcoded
 * outside of these defaults.
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
  /** `true` reflects the request origin, otherwise a fixed allow-list. */
  corsOrigin: true | string[];
  /** Normalized, no trailing slash, e.g. http://localhost:4566 */
  localstackEndpoint: string;
  /**
   * Endpoint written into generated client artifacts (the EKS kubeconfig).
   * Never used for api→LocalStack traffic: when the api runs in Docker the
   * internal endpoint (`host.docker.internal`) is not resolvable from the
   * machine where kubectl runs, so `LOCALSTACK_PUBLIC_ENDPOINT` overrides it.
   * Falls back to `localstackEndpoint`.
   */
  localstackPublicEndpoint: string;
  /** Absolute URL of the LocalStack health endpoint. */
  localstackHealthUrl: string;
  region: string;
  /** Per-request timeout for LocalStack health probes. */
  localstackTimeoutMs: number;
  /** TCP connect timeout for AWS SDK calls against LocalStack. */
  localstackConnectionTimeoutMs: number;
  /** Whole-request timeout for AWS SDK calls against LocalStack. */
  localstackRequestTimeoutMs: number;
  /** How long a successful health probe is reused (0 disables the cache). */
  localstackHealthCacheMs: number;
  /** How long a graceful shutdown may drain before the process is forced out. */
  shutdownTimeoutMs: number;
  /** How often the ui should refresh the status widget. */
  statusPollIntervalMs: number;
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
  localstackEndpoint: 'http://localhost:4566',
  region: 'us-east-1',
  localstackTimeoutMs: 5_000,
  localstackConnectionTimeoutMs: 5_000,
  localstackRequestTimeoutMs: 30_000,
  localstackHealthCacheMs: 2_000,
  shutdownTimeoutMs: 10_000,
  statusPollIntervalMs: 15_000,
} as const;

function readEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function parseBooleanEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readEnv(env, key)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigurationError(`${key} must be a boolean, received "${raw}"`);
}

function normalizeEndpoint(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigurationError(`LOCALSTACK_ENDPOINT is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigurationError(
      `LOCALSTACK_ENDPOINT must use http or https, received "${url.protocol}"`,
    );
  }
  if (url.hostname.length === 0) {
    throw new ConfigurationError(`LOCALSTACK_ENDPOINT must include a host, received "${raw}"`);
  }
  return url.toString().replace(/\/+$/, '');
}

function parseCorsOrigin(raw: string | undefined): true | string[] {
  if (raw === undefined || raw === '*') return true;
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : true;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const endpoint = normalizeEndpoint(
    readEnv(env, 'LOCALSTACK_ENDPOINT') ?? DEFAULTS.localstackEndpoint,
  );
  const publicEndpointRaw = readEnv(env, 'LOCALSTACK_PUBLIC_ENDPOINT');
  const environment = readEnv(env, 'NODE_ENV') ?? DEFAULTS.environment;
  const isProduction = environment === 'production';

  return {
    applicationName: DEFAULTS.applicationName,
    version: readPackageVersion(env),
    environment,
    isProduction,
    host: readEnv(env, 'HOST') ?? DEFAULTS.host,
    port: parseIntEnv(env, 'PORT', DEFAULTS.port, { min: 1, max: 65_535 }),
    logLevel: readEnv(env, 'LOG_LEVEL') ?? DEFAULTS.logLevel,
    // A production image has no pino-pretty (devDependency); forcing pretty
    // logging off there keeps LOG_PRETTY=true from breaking startup.
    logPretty: !isProduction && parseBooleanEnv(env, 'LOG_PRETTY', true),
    corsOrigin: parseCorsOrigin(readEnv(env, 'CORS_ORIGIN')),
    localstackEndpoint: endpoint,
    localstackPublicEndpoint:
      publicEndpointRaw === undefined ? endpoint : normalizeEndpoint(publicEndpointRaw),
    localstackHealthUrl: new URL(LOCALSTACK_HEALTH_PATH, `${endpoint}/`).toString(),
    region: readEnv(env, 'AWS_REGION') ?? DEFAULTS.region,
    localstackTimeoutMs: parseIntEnv(env, 'LOCALSTACK_TIMEOUT_MS', DEFAULTS.localstackTimeoutMs, {
      min: 100,
      max: 120_000,
    }),
    localstackConnectionTimeoutMs: parseIntEnv(
      env,
      'LOCALSTACK_CONNECTION_TIMEOUT_MS',
      DEFAULTS.localstackConnectionTimeoutMs,
      { min: 100, max: 120_000 },
    ),
    localstackRequestTimeoutMs: parseIntEnv(
      env,
      'LOCALSTACK_REQUEST_TIMEOUT_MS',
      DEFAULTS.localstackRequestTimeoutMs,
      { min: 100, max: 600_000 },
    ),
    localstackHealthCacheMs: parseIntEnv(
      env,
      'LOCALSTACK_HEALTH_CACHE_MS',
      DEFAULTS.localstackHealthCacheMs,
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
