import { defineConfig, devices } from '@playwright/test';
import { IS_CI } from './support';

/**
 * Minimal Playwright project for the *shipped* containers: it drives the ui
 * container (nginx serving the built bundle, proxying /api to the api
 * container) at http://127.0.0.1:${E2E_CONTAINER_UI_PORT}. No webServer is
 * started here — `docker compose up` owns both containers, and the spec uploads
 * an object larger than nginx's 1 MiB default body cap.
 *
 * Run it after `docker compose up --build`:
 *   pnpm --filter @localdeck/e2e test:container
 */
const uiPort = Number.parseInt(process.env.E2E_CONTAINER_UI_PORT ?? '8080', 10);
if (!Number.isInteger(uiPort) || uiPort < 1 || uiPort > 65_535) {
  throw new Error('E2E_CONTAINER_UI_PORT must be an integer port');
}

export default defineConfig({
  testDir: './tests/container',
  outputDir: './test-results-container',
  fullyParallel: false,
  workers: 1,
  forbidOnly: IS_CI,
  // The spec creates real S3 resources; a retry would only repeat the cleanup.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: IS_CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-container' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
