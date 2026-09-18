import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from '../src/app.js';
import { ConfigurationError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('falls back to the documented LocalStack defaults', () => {
    const config = loadConfig({});

    expect(config.localstackEndpoint).toBe('http://localhost:4566');
    expect(config.localstackHealthUrl).toBe('http://localhost:4566/_localstack/health');
    expect(config.region).toBe('us-east-1');
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
    expect(config.environment).toBe('development');
    expect(config.logPretty).toBe(true);
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

    expect(config.localstackEndpoint).toBe('http://host.docker.internal:4566');
    expect(config.localstackHealthUrl).toBe('http://host.docker.internal:4566/_localstack/health');
    expect(config.region).toBe('eu-west-1');
    expect(config.port).toBe(8080);
    expect(config.isProduction).toBe(true);
    expect(config.logPretty).toBe(false);
    expect(config.logLevel).toBe('debug');
    expect(config.corsOrigin).toEqual(['http://localhost:5173', 'http://localhost:8080']);
  });

  it('accepts a bare host:port endpoint', () => {
    expect(loadConfig({ LOCALSTACK_ENDPOINT: 'localstack:4566' }).localstackEndpoint).toBe(
      'http://localstack:4566',
    );
  });

  it('defaults CORS to reflecting the request origin', () => {
    expect(loadConfig({}).corsOrigin).toBe(true);
    expect(loadConfig({ CORS_ORIGIN: '*' }).corsOrigin).toBe(true);
  });

  it('rejects an unparsable endpoint', () => {
    expect(() => loadConfig({ LOCALSTACK_ENDPOINT: 'http://not a host' })).toThrow(
      ConfigurationError,
    );
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

  it('exposes the outbound SDK timeout configuration', () => {
    const config = loadConfig({
      LOCALSTACK_CONNECTION_TIMEOUT_MS: '2500',
      LOCALSTACK_REQUEST_TIMEOUT_MS: '45000',
    });

    expect(config.localstackConnectionTimeoutMs).toBe(2500);
    expect(config.localstackRequestTimeoutMs).toBe(45000);
    expect(loadConfig({}).localstackRequestTimeoutMs).toBe(30_000);
  });

  it('defaults the public endpoint to the configured endpoint', () => {
    expect(
      loadConfig({ LOCALSTACK_ENDPOINT: 'http://localstack:4566' }).localstackPublicEndpoint,
    ).toBe('http://localstack:4566');
    expect(
      loadConfig({
        LOCALSTACK_ENDPOINT: 'http://host.docker.internal:4566',
        LOCALSTACK_PUBLIC_ENDPOINT: 'http://127.0.0.1:4566/',
      }).localstackPublicEndpoint,
    ).toBe('http://127.0.0.1:4566');
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
    expect(loadConfig({}).localstackHealthCacheMs).toBe(2000);
    expect(loadConfig({ LOCALSTACK_HEALTH_CACHE_MS: '0' }).localstackHealthCacheMs).toBe(0);
  });

  it('exposes the ui poll interval', () => {
    expect(loadConfig({ UI_STATUS_POLL_INTERVAL_MS: '5000' }).statusPollIntervalMs).toBe(5000);
  });
});
