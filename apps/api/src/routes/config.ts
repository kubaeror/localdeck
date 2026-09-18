import { API_PATHS, type ApiConfigResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

/**
 * Effective, env-driven configuration. The ui uses this to render the status
 * widget (endpoint + region) without ever knowing about build-time values.
 */
export function registerConfigRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get(API_PATHS.config, async (): Promise<ApiConfigResponse> => {
    return {
      application: {
        name: config.applicationName,
        version: config.version,
        environment: config.environment,
      },
      localstack: {
        endpoint: config.localstackEndpoint,
        region: config.region,
        healthPath: new URL(config.localstackHealthUrl).pathname,
      },
      ui: {
        statusPollIntervalMs: config.statusPollIntervalMs,
      },
    };
  });
}
