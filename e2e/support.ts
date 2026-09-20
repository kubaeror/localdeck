import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Values shared by the Playwright configuration, the tests and the global
 * setup/teardown: the origins the suite drives and the log of resources it
 * created, so a crashed run can still be swept up afterwards.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be an integer port, received "${raw}"`);
  }
  return parsed;
}

export const API_PORT = readPort('E2E_API_PORT', 3001);
export const UI_PORT = readPort('E2E_UI_PORT', 5173);
export const LOCALSTACK_ENDPOINT =
  process.env.EMULATOR_ENDPOINT ?? process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566';

export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
export const UI_ORIGIN = `http://127.0.0.1:${UI_PORT}`;

/** Every resource this suite creates starts with this prefix (or carries the tag). */
export const E2E_RESOURCE_PREFIX = 'localdeck-e2e';
export const E2E_TAG_KEY = 'localdeck:e2e';

/**
 * JSONL log of resources the suite created. Playwright runs globalTeardown in a
 * separate process, so in-memory bookkeeping would be lost; the file lives
 * under the (gitignored) test-results directory and is cleaned by Playwright.
 */
const CLEANUP_LOG = path.join(REPO_ROOT, 'e2e', 'test-results', 'e2e-cleanup.jsonl');

export type E2eResourceKind = 's3-bucket' | 'ec2-instance' | 'eks-cluster';

export interface E2eResource {
  kind: E2eResourceKind;
  id: string;
}

/** Records a resource for the global teardown sweep. Never throws. */
export function trackResource(kind: E2eResourceKind, id: string): void {
  try {
    mkdirSync(path.dirname(CLEANUP_LOG), { recursive: true });
    appendFileSync(CLEANUP_LOG, `${JSON.stringify({ kind, id } satisfies E2eResource)}\n`, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[e2e] could not record ${kind} ${id} for cleanup: ${message}`);
  }
}

/** Reads the resources recorded by this (or a crashed previous) run. */
export function readTrackedResources(): E2eResource[] {
  let raw: string;
  try {
    raw = readFileSync(CLEANUP_LOG, 'utf8');
  } catch {
    return [];
  }
  const resources: E2eResource[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<E2eResource>;
      if (
        (parsed.kind === 's3-bucket' ||
          parsed.kind === 'ec2-instance' ||
          parsed.kind === 'eks-cluster') &&
        typeof parsed.id === 'string' &&
        // Buckets and clusters carry the suite prefix; instance ids are i-*.
        (parsed.kind === 'ec2-instance'
          ? /^i-[0-9a-f]+$/i.test(parsed.id)
          : parsed.id.startsWith(E2E_RESOURCE_PREFIX))
      ) {
        resources.push({ kind: parsed.kind, id: parsed.id });
      }
    } catch {
      // A truncated line from a killed run is ignored.
    }
  }
  return resources;
}

/** Clears the cleanup log (global setup starts every run from an empty log). */
export function clearTrackedResources(): void {
  rmSync(CLEANUP_LOG, { force: true });
}
