import {
  API_PATHS,
  getEmulatorProvider,
  type ConsoleContractResponse,
  type ConsoleContractUnavailableResponse,
  type HealthResponse,
  type LivenessResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { probeEmulatorHealth } from '../lib/emulatorHealth.js';
import { toApiError } from '../lib/errors.js';

export function registerHealthRoutes(app: FastifyInstance, config: AppConfig): void {
  /**
   * Liveness: answers as long as the api process is up, regardless of the
   * emulator. Container orchestration must use this endpoint so a stopped
   * emulator never causes restart loops.
   */
  app.get(API_PATHS.liveness, async (): Promise<LivenessResponse> => {
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  /**
   * Readiness: the real emulator service statuses. 503 + ApiErrorResponse when
   * the emulator cannot be reached.
   *
   * Semantics decision (API-023): a reachable emulator with zero enabled
   * services or services in `error` answers 200 with `status: 'degraded'` —
   * this is the ui's status-widget endpoint and starting/empty emulators are a
   * normal state, not an api failure. Only an unreachable or malformed health
   * endpoint produces 503/502.
   *
   * In Floci Console Contract v1 mode (LOCALDECK_CONSOLE_CONTRACT=1) an
   * unreachable emulator answers 200 `{status:"unavailable"}`, which is what
   * the Floci sidecar supervisor expects.
   */
  app.get(API_PATHS.health, async (): Promise<HealthResponse | ConsoleContractResponse> => {
    try {
      const probe = await probeEmulatorHealth(config);
      const { counts } = probe.snapshot;
      const degraded = counts.error > 0 || counts.enabled === 0;

      const body: HealthResponse = {
        status: degraded ? 'degraded' : 'ok',
        checkedAt: probe.checkedAt,
        latencyMs: probe.latencyMs,
        endpoint: config.emulatorEndpoint,
        region: config.region,
        provider: {
          provider: probe.snapshot.provider,
          providerLabel: probe.snapshot.providerLabel,
          version: probe.snapshot.version,
          edition: probe.snapshot.edition,
          docsUrl: getEmulatorProvider(probe.snapshot.provider).docsUrl,
        },
        emulator: probe.snapshot,
      };

      if (config.consoleContractMode) {
        return {
          ...body,
          // Contract v1 asks whether the emulator is reachable, not whether
          // every service is healthy: a reachable-but-degraded emulator must
          // still read "ok" or the supervisor keeps showing the interstitial.
          status: 'ok',
          endpoint: config.emulatorEndpoint,
          error: null,
          console: { name: config.applicationName, version: config.version },
        };
      }
      return body;
    } catch (error) {
      if (!config.consoleContractMode) throw error;
      const apiError = toApiError(error, { endpoint: config.emulatorEndpoint });
      const unavailable: ConsoleContractUnavailableResponse = {
        status: 'unavailable',
        endpoint: config.emulatorEndpoint,
        error: apiError.message,
        console: { name: config.applicationName, version: config.version },
      };
      return unavailable;
    }
  });
}
