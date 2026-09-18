import { chromium, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Captures the README screenshots from a running LocalDeck ui. Only LocalDeck's
 * own console is ever photographed — never a screenshot of another cloud
 * console, which the repository must not contain.
 *
 * Usage: start `pnpm dev` (or the docker compose stack) with LocalStack up,
 * then:
 *
 *   LOCALDECK_SCREENSHOT_BASE_URL=http://localhost:5173 pnpm --filter @localdeck/e2e screens
 *
 * The script seeds a demo bucket through the api dispatcher and deletes it
 * again afterwards, so the S3 pages show real LocalStack data.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'docs', 'screens');
const BASE_URL = process.env.LOCALDECK_SCREENSHOT_BASE_URL ?? 'http://localhost:5173';
const DEMO_BUCKET = process.env.LOCALDECK_SCREENSHOT_BUCKET ?? 'localdeck-demo-bucket';

interface DispatcherRequest {
  service: string;
  operation: string;
  input: Record<string, unknown>;
}

async function callDispatcher({ service, operation, input }: DispatcherRequest): Promise<void> {
  const response = await fetch(
    `${BASE_URL}/api/services/${encodeURIComponent(service)}/${encodeURIComponent(operation)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new Error(
      `${service}.${operation} failed with ${response.status}: ${await response.text()}`,
    );
  }
}

async function seedDemoBucket(): Promise<void> {
  // Best effort: recreate the bucket so the list is never empty in the shot.
  await callDispatcher({
    service: 's3',
    operation: 'DeleteBucket',
    input: { Bucket: DEMO_BUCKET },
  });
  await callDispatcher({
    service: 's3',
    operation: 'CreateBucket',
    input: { Bucket: DEMO_BUCKET },
  });
}

async function removeDemoBucket(): Promise<void> {
  await callDispatcher({
    service: 's3',
    operation: 'DeleteBucket',
    input: { Bucket: DEMO_BUCKET },
  });
}

async function capture(
  page: Page,
  name: string,
  url: string,
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle' });
  if (prepare !== undefined) {
    await prepare(page);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
  console.log(`captured ${name}.png`);
}

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await seedDemoBucket();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const page = await context.newPage();

  try {
    await capture(page, 'console-home', '/console/home');
    await capture(page, 'service-health', '/console/health');
    await capture(page, 's3-buckets', '/console/s3');
    await capture(page, 's3-create-bucket', '/console/s3/create', async (target) => {
      await target.getByRole('textbox', { name: 'Bucket name' }).fill(DEMO_BUCKET);
    });
    await capture(page, 'ec2-instances', '/console/ec2/instances');
    await capture(page, 'ec2-launch-instance', '/console/ec2/instances/launch');
    await capture(page, 'eks-clusters', '/console/eks');
    await capture(page, 'eks-create-cluster', '/console/eks/create', async (target) => {
      await target.getByRole('textbox', { name: 'Name' }).fill('localdeck-demo-cluster');
      await target.getByRole('button', { name: 'Kubernetes version' }).waitFor();
    });
  } finally {
    await context.close();
    await browser.close();
    await removeDemoBucket();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
