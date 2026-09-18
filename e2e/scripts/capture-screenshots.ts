import { chromium, type Locator, type Page } from '@playwright/test';
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
 * CI runs the same script against the ui container and uploads `docs/screens/`
 * as an artifact; committing a refresh stays a developer decision.
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

interface CaptureOptions {
  /**
   * A locator that only becomes visible once the page's real data rendered.
   * This replaces the fixed sleeps the script used before: the screenshot is
   * taken when the console says the page is ready, not after an arbitrary wait.
   */
  ready?: Locator;
  prepare?: (page: Page) => Promise<void>;
}

async function capture(
  page: Page,
  name: string,
  url: string,
  options: CaptureOptions = {},
): Promise<void> {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' });
  // Cloudscape's AppLayout renders the page content inside <main>; waiting for
  // the shell (and then the page-specific locator) is the stable condition.
  await page.locator('main, [role="main"], #root > *').first().waitFor({ state: 'visible' });
  if (options.ready !== undefined) {
    await options.ready.first().waitFor({ state: 'visible' });
  }
  if (options.prepare !== undefined) {
    await options.prepare(page);
  }
  // Late data requests (health, lists) finish before the shot; this is a
  // network condition, not a timeout.
  await page.waitForLoadState('networkidle');
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
    await capture(page, 'console-home', '/console/home', {
      ready: page.getByRole('heading', { name: 'Console Home' }),
    });
    await capture(page, 'service-health', '/console/health', {
      ready: page.getByRole('heading', { name: 'Service health' }),
    });
    await capture(page, 's3-buckets', '/console/s3', {
      // Wait for the seeded bucket: the list must show real LocalStack data.
      ready: page.getByText(DEMO_BUCKET),
    });
    await capture(page, 's3-create-bucket', '/console/s3/create', {
      ready: page.getByRole('heading', { name: 'Create bucket' }),
      prepare: async (target) => {
        await target.getByRole('textbox', { name: 'Bucket name' }).fill(DEMO_BUCKET);
      },
    });
    await capture(page, 'ec2-instances', '/console/ec2/instances', {
      ready: page.getByRole('heading', { level: 1 }).first(),
    });
    await capture(page, 'ec2-launch-instance', '/console/ec2/instances/launch', {
      ready: page.getByRole('heading', { name: 'Launch instance' }),
    });
    await capture(page, 'eks-clusters', '/console/eks', {
      ready: page.getByRole('heading', { level: 1 }).first(),
    });
    await capture(page, 'eks-create-cluster', '/console/eks/create', {
      // Licensed LocalStack: the wizard's name field. Unlicensed: the honest
      // not-enabled page, which is worth photographing too.
      ready: page
        .getByRole('textbox', { name: 'Name' })
        .or(page.getByText('EKS is not enabled in this LocalStack instance'))
        .first(),
      prepare: async (target) => {
        const nameField = target.getByRole('textbox', { name: 'Name' });
        if (await nameField.isVisible().catch(() => false)) {
          await nameField.fill('localdeck-demo-cluster');
          await target.getByRole('button', { name: 'Kubernetes version' }).waitFor();
        }
      },
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
