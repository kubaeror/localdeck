import { API_PATHS, getEmulatorProvider, type ApiConfigResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

/**
 * Effective, env-driven configuration. The ui uses this to render the status
 * widget (provider + endpoint + region) without ever knowing about build-time
 * values, and the CLI hints for endpoints that must be reachable from the host.
 */
export function registerConfigRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get(API_PATHS.config, async (): Promise<ApiConfigResponse> => {
    const pinned =
      config.emulatorProvider === 'auto' ? undefined : getEmulatorProvider(config.emulatorProvider);
    return {
      application: {
        name: config.applicationName,
        version: config.version,
        environment: config.environment,
      },
      emulator: {
        provider: config.emulatorProvider,
        providerLabel: pinned?.displayName ?? 'Auto-detect',
        endpoint: config.emulatorEndpoint,
        publicEndpoint: config.emulatorPublicEndpoint,
        region: config.region,
        healthPaths: pinned?.healthPaths ?? [
          '/_floci/health',
          '/_ministack/health',
          '/_localstack/health',
        ],
      },
      ui: {
        statusPollIntervalMs: config.statusPollIntervalMs,
      },
    };
  });
}
