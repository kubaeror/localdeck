import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../src/app.js';
import { ConfigurationError, loadConfig, resolveEmulatorEndpoint } from '../src/config.js';

describe('loadConfig', () => {
  it('falls back to the documented emulator defaults', () => {
    const config = loadConfig({});

    expect(config.emulatorEndpoint).toBe('http://localhost:4566');
    expect(config.emulatorProvider).toBe('auto');
    expect(config.region).toBe('us-east-1');
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
    expect(config.environment).toBe('development');
    expect(config.logPretty).toBe(true);
    expect(config.consoleContractMode).toBe(false);
  });

  it('reads the endpoint, region and log settings from the environment', () => {
    const config = loadConfig({
      LOCALSTACK_ENDPOINT: 'http://host.docker.internal:4566/',
      AWS_REGION: 'eu-west-1',
      PORT: '8080',
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      CORS_ORIGIN: 'http://localhost:5173, http://localhost:8080',
    });

    expect(config.emulatorEndpoint).toBe('http://host.docker.internal:4566');
    expect(config.region).toBe('eu-west-1');
    expect(config.port).toBe(8080);
    expect(config.isProduction).toBe(true);
    expect(config.logPretty).toBe(false);
    expect(config.logLevel).toBe('debug');
    expect(config.corsOrigin).toEqual(['http://localhost:5173', 'http://localhost:8080']);
  });

  it('accepts a bare host:port endpoint', () => {
    expect(loadConfig({ LOCALSTACK_ENDPOINT: 'localstack:4566' }).emulatorEndpoint).toBe(
      'http://localstack:4566',
    );
  });

  it('prefers EMULATOR_ENDPOINT over AWS_ENDPOINT_URL over LOCALSTACK_ENDPOINT', () => {
    expect(
      resolveEmulatorEndpoint({
        EMULATOR_ENDPOINT: 'http://emulator:4566',
        AWS_ENDPOINT_URL: 'http://aws-env:4566',
        LOCALSTACK_ENDPOINT: 'http://localstack:4566',
      }),
    ).toBe('http://emulator:4566');
    expect(
      resolveEmulatorEndpoint({
        AWS_ENDPOINT_URL: 'http://aws-env:4566',
        LOCALSTACK_ENDPOINT: 'http://localstack:4566',
      }),
    ).toBe('http://aws-env:4566');
    expect(resolveEmulatorEndpoint({ LOCALSTACK_ENDPOINT: 'http://localstack:4566' })).toBe(
      'http://localstack:4566',
    );
  });

  it('accepts the Floci sidecar endpoint variable through AWS_ENDPOINT_URL', () => {
    expect(loadConfig({ AWS_ENDPOINT_URL: 'http://floci:4566' }).emulatorEndpoint).toBe(
      'http://floci:4566',
    );
  });

  it('defaults CORS to same-origin only and requires an explicit opt-in for reflection', () => {
    expect(loadConfig({}).corsOrigin).toBe(false);
    expect(loadConfig({ CORS_ORIGIN: '*' }).corsOrigin).toBe(true);
    expect(loadConfig({ CORS_ORIGIN: ' , ' }).corsOrigin).toBe(false);
  });

  it('parses a pinned emulator provider and rejects unknown ones', () => {
    expect(loadConfig({ EMULATOR_PROVIDER: 'floci' }).emulatorProvider).toBe('floci');
    expect(loadConfig({ EMULATOR_PROVIDER: 'MINISTACK' }).emulatorProvider).toBe('ministack');
    expect(loadConfig({ EMULATOR_PROVIDER: 'auto' }).emulatorProvider).toBe('auto');
    expect(() => loadConfig({ EMULATOR_PROVIDER: 'moto' })).toThrow(ConfigurationError);
  });

  it('rejects an unparsable endpoint', () => {
    expect(() => loadConfig({ LOCALSTACK_ENDPOINT: 'http://not a host' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects endpoint credentials instead of echoing them to clients', () => {
    expect(() => loadConfig({ EMULATOR_ENDPOINT: 'http://user:pass@localhost:4566' })).toThrow(
      /must not contain credentials/,
    );
    expect(() => loadConfig({ EMULATOR_ENDPOINT: 'http://localhost:4566/?a=1' })).toThrow(
      /query string or fragment/,
    );
  });

  it('validates LOG_LEVEL instead of failing inside pino at startup', () => {
    expect(loadConfig({ LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(ConfigurationError);
  });

  it('rejects trailing garbage instead of truncating integers (API-012)', () => {
    expect(() => loadConfig({ PORT: '3001abc' })).toThrow(/must be an integer/);
    expect(() => loadConfig({ LOCALSTACK_REQUEST_TIMEOUT_MS: '30s' })).toThrow(
      /must be an integer/,
    );
    expect(() => loadConfig({ LOCALSTACK_CONNECTION_TIMEOUT_MS: '1.5' })).toThrow(
      /must be an integer/,
    );
  });

  it('exposes the outbound SDK timeout configuration through both env families', () => {
    const legacy = loadConfig({
      LOCALSTACK_CONNECTION_TIMEOUT_MS: '2500',
      LOCALSTACK_REQUEST_TIMEOUT_MS: '45000',
    });

    expect(legacy.emulatorConnectionTimeoutMs).toBe(2500);
    expect(legacy.emulatorRequestTimeoutMs).toBe(45000);
    expect(loadConfig({}).emulatorRequestTimeoutMs).toBe(30_000);

    const modern = loadConfig({
      EMULATOR_CONNECTION_TIMEOUT_MS: '1500',
      EMULATOR_REQUEST_TIMEOUT_MS: '60000',
      LOCALSTACK_REQUEST_TIMEOUT_MS: '9999',
    });
    expect(modern.emulatorConnectionTimeoutMs).toBe(1500);
    expect(modern.emulatorRequestTimeoutMs).toBe(60000);
  });

  it('defaults the public endpoint to the configured endpoint', () => {
    expect(
      loadConfig({ LOCALSTACK_ENDPOINT: 'http://localstack:4566' }).emulatorPublicEndpoint,
    ).toBe('http://localstack:4566');
    expect(
      loadConfig({
        EMULATOR_ENDPOINT: 'http://host.docker.internal:4566',
        EMULATOR_PUBLIC_ENDPOINT: 'http://127.0.0.1:4566/',
      }).emulatorPublicEndpoint,
    ).toBe('http://127.0.0.1:4566');
    expect(
      loadConfig({
        LOCALSTACK_ENDPOINT: 'http://host.docker.internal:4566',
        LOCALSTACK_PUBLIC_ENDPOINT: 'http://localhost:4566',
      }).emulatorPublicEndpoint,
    ).toBe('http://localhost:4566');
  });

  it('forces pretty logging off in production (API-010)', () => {
    const config = loadConfig({ NODE_ENV: 'production', LOG_PRETTY: 'true' });
    expect(config.isProduction).toBe(true);
    expect(config.logPretty).toBe(false);

    // Defense in depth: even a hand-built config cannot pull the dev-only
    // pino-pretty transport into a production logger.
    const logger = createLoggerOptions({ ...config, logPretty: true });
    expect(logger).not.toHaveProperty('transport');

    const devLogger = createLoggerOptions(loadConfig({ NODE_ENV: 'development' }));
    expect(devLogger).toHaveProperty('transport.target', 'pino-pretty');
  });

  it('allows disabling the health probe cache', () => {
    expect(loadConfig({}).emulatorHealthCacheMs).toBe(2000);
    expect(loadConfig({ LOCALSTACK_HEALTH_CACHE_MS: '0' }).emulatorHealthCacheMs).toBe(0);
    expect(loadConfig({ EMULATOR_HEALTH_CACHE_MS: '500' }).emulatorHealthCacheMs).toBe(500);
  });

  it('enables the Floci console contract mode explicitly', () => {
    expect(loadConfig({ LOCALDECK_CONSOLE_CONTRACT: '1' }).consoleContractMode).toBe(true);
    expect(loadConfig({ LOCALDECK_CONSOLE_CONTRACT: 'no' }).consoleContractMode).toBe(false);
  });

  it('exposes the ui poll interval', () => {
    expect(loadConfig({ UI_STATUS_POLL_INTERVAL_MS: '5000' }).statusPollIntervalMs).toBe(5000);
  });
});
