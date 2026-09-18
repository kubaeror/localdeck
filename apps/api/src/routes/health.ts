import { API_PATHS, type HealthResponse, type LivenessResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import { probeLocalStackHealth } from '../lib/localstackHealth.js';

export function registerHealthRoutes(app: FastifyInstance, config: AppConfig): void {
  /**
   * Liveness: answers as long as the api process is up, regardless of
   * LocalStack. Container orchestration must use this endpoint so a stopped
   * LocalStack never causes restart loops.
   */
  app.get(API_PATHS.liveness, async (): Promise<LivenessResponse> => {
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  /**
   * Readiness: the real LocalStack service statuses. 503 + ApiErrorResponse
   * when LocalStack cannot be reached.
   */
  app.get(API_PATHS.health, async (): Promise<HealthResponse> => {
    const probe = await probeLocalStackHealth(config);
    const degraded = probe.snapshot.counts.error > 0 || probe.snapshot.counts.available === 0;

    return {
      status: degraded ? 'degraded' : 'ok',
      checkedAt: probe.checkedAt,
      latencyMs: probe.latencyMs,
      endpoint: config.localstackEndpoint,
      region: config.region,
      localstack: probe.snapshot,
    };
  });
}
