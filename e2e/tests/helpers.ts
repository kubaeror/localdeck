import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';

/**
 * Shared helpers for the smoke suite. They keep the specs focused on the
 * console's behaviour while all LocalStack traffic goes through the LocalDeck
 * api, exactly like the browser does.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface LocalStackCounts {
  total?: number;
  available?: number;
  error?: number;
  running?: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  endpoint: string;
  region: string;
  localstack: {
    services: Record<string, string>;
    counts: LocalStackCounts;
    version?: string;
  };
}

/** Reads the api's normalized LocalStack health document. */
export async function fetchHealth(request: APIRequestContext): Promise<HealthResponse> {
  const response = await request.get('/api/health');
  if (response.status() !== 200) {
    throw new Error(
      `GET /api/health answered ${response.status()} instead of 200: ${await response.text()}`,
    );
  }
  return (await response.json()) as HealthResponse;
}

/** True when the emulator reports the service (any non-error status). */
export function isEmulated(health: HealthResponse, service: string): boolean {
  const status = health.localstack.services[service];
  return status !== undefined && status !== 'error' && status !== 'disabled';
}

export interface ServiceOperationResponse<TResult = unknown> {
  result: TResult;
}

/**
 * Calls one whitelisted operation through the dynamic dispatcher — the same
 * route the ui uses. Useful for fixtures and cleanup, so the browser flow under
 * test stays the only thing a spec asserts on.
 */
export async function callServiceOperation<TResult = unknown>(
  request: APIRequestContext,
  service: string,
  operation: string,
  input: Record<string, unknown> = {},
): Promise<TResult> {
  const response = await request.post(
    `/api/services/${encodeURIComponent(service)}/${encodeURIComponent(operation)}`,
    { data: { input } },
  );
  if (!response.ok()) {
    throw new Error(
      `POST /api/services/${service}/${operation} answered ${response.status()}: ${await response.text()}`,
    );
  }
  const body = (await response.json()) as ServiceOperationResponse<TResult>;
  return body.result;
}

/** A collision-free name for resources this suite creates and deletes. */
export function uniqueName(prefix: string): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${random}`;
}

/**
 * Deletes a cluster after waiting for it to settle. LocalStack's k3d teardown
 * races with a cluster that is still CREATING, which can leave orphaned k3d
 * containers behind, so the helper polls DescribeCluster first. Cleanup must
 * never fail the test it follows: problems are reported, not thrown.
 */
export async function deleteClusterIfExists(
  request: APIRequestContext,
  name: string,
): Promise<void> {
  const deadline = Date.now() + 240_000;
  let settled = false;
  while (!settled && Date.now() < deadline) {
    try {
      const result = await callServiceOperation<{ cluster?: { status?: string } }>(
        request,
        'eks',
        'DescribeCluster',
        { name },
      );
      const status = result.cluster?.status;
      if (status === 'ACTIVE' || status === 'FAILED') {
        settled = true;
      } else if (status === undefined || status === 'DELETING') {
        // Already gone, or LocalStack is tearing it down itself.
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ResourceNotFound|not found/i.test(message)) return;
      // A transient error while the control plane starts: retry until deadline.
    }
    if (!settled) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  try {
    await callServiceOperation(request, 'eks', 'DeleteCluster', { name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ResourceInUse|in progress|Conflict|ResourceNotFound/i.test(message)) {
      console.warn(`[e2e] could not delete the EKS cluster ${name}: ${message}`);
    }
  }
}
