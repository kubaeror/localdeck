import type { APIRequestContext } from '@playwright/test';
import { E2E_RESOURCE_PREFIX, E2E_TAG_KEY, REPO_ROOT, trackResource } from '../support';

/**
 * Shared helpers for the smoke suite. They keep the specs focused on the
 * console's behaviour while all LocalStack traffic goes through the LocalDeck
 * api, exactly like the browser does.
 */

export { E2E_RESOURCE_PREFIX, E2E_TAG_KEY, REPO_ROOT, trackResource };

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

export interface ApiConfigResponse {
  application: { name: string; version: string; environment: string };
  localstack: { endpoint: string; region: string; healthPath: string };
  ui: { statusPollIntervalMs: number };
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

/**
 * Reads the effective api configuration. Fixtures (region, account) are
 * derived from it instead of hardcoding `us-east-1`/`000000000000`, so the
 * suite follows whatever the running api was configured with.
 */
export async function fetchConfig(request: APIRequestContext): Promise<ApiConfigResponse> {
  const response = await request.get('/api/config');
  if (response.status() !== 200) {
    throw new Error(
      `GET /api/config answered ${response.status()} instead of 200: ${await response.text()}`,
    );
  }
  return (await response.json()) as ApiConfigResponse;
}

/**
 * The account id LocalStack uses for the caller, read from STS through the
 * dispatcher. Falls back to LocalStack's well-known 12-zero account when STS
 * is not emulated; the fixture is only used to build a syntactically valid
 * role ARN, which LocalStack stores without validating.
 */
export async function fetchAccountId(request: APIRequestContext): Promise<string> {
  try {
    const identity = await callServiceOperation<{ Account?: string }>(
      request,
      'sts',
      'GetCallerIdentity',
      {},
    );
    if (typeof identity.Account === 'string' && /^[0-9]{12}$/.test(identity.Account)) {
      return identity.Account;
    }
  } catch {
    // STS is not part of every emulator profile; fall back to LocalStack's
    // well-known account id, which is all a valid role ARN fixture needs.
  }
  return '000000000000';
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
 * Removes every object in the bucket, then the bucket itself. Problems are
 * reported, not thrown: the global teardown sweeps anything left behind.
 */
export async function deleteBucketIfExists(
  request: APIRequestContext,
  bucket: string,
): Promise<void> {
  try {
    for (;;) {
      const listed = await callServiceOperation<{ Contents?: { Key?: string }[] }>(
        request,
        's3',
        'ListObjectsV2',
        { Bucket: bucket, MaxKeys: 1000 },
      );
      const keys = (listed.Contents ?? [])
        .map((entry) => entry.Key)
        .filter((key): key is string => typeof key === 'string');
      if (keys.length === 0) break;
      await callServiceOperation(request, 's3', 'DeleteObjects', {
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      });
    }
    await callServiceOperation(request, 's3', 'DeleteBucket', { Bucket: bucket });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/NoSuchBucket|not found/i.test(message)) return;
    console.warn(`[e2e] could not delete the S3 bucket ${bucket}: ${message}`);
  }
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
