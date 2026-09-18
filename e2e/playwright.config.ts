import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * LocalDeck's end-to-end smoke suite.
 *
 * The suite talks to a real LocalStack that is managed OUTSIDE this project:
 * locally that is the instance you already run, in CI it is the throwaway
 * service container described in `.github/workflows/ci.yml`. Playwright starts
 * the api and ui itself (unless they are already running, which makes local
 * development convenient) and never touches LocalStack's lifecycle.
 *
 * Run it with `pnpm test:e2e` after `pnpm build` (shared types must exist), or
 * simply `pnpm test:e2e` when `pnpm dev` is already running.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

const apiPort = Number.parseInt(process.env.E2E_API_PORT ?? '3001', 10);
const uiPort = Number.parseInt(process.env.E2E_UI_PORT ?? '5173', 10);
const localstackEndpoint = process.env.LOCALSTACK_ENDPOINT ?? 'http://localhost:4566';

if (!Number.isInteger(apiPort) || !Number.isInteger(uiPort)) {
  throw new Error('E2E_API_PORT and E2E_UI_PORT must be integers');
}

const apiOrigin = `http://127.0.0.1:${apiPort}`;
const uiOrigin = `http://127.0.0.1:${uiPort}`;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  /* The smoke suite creates real resources in one LocalStack, so it runs in a
     single worker and stays order-independent (every test cleans up after
     itself). */
  fullyParallel: false,
  workers: 1,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: uiOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The api is the only process that talks to LocalStack; it keeps the
      // endpoint from the environment (never hardcoded).
      command: 'pnpm exec tsx apps/api/src/index.ts',
      cwd: REPO_ROOT,
      url: `${apiOrigin}/api/health/live`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        HOST: '127.0.0.1',
        PORT: String(apiPort),
        LOCALSTACK_ENDPOINT: localstackEndpoint,
        LOG_LEVEL: 'warn',
        LOG_PRETTY: 'false',
      },
    },
    {
      // CI smoke-tests the production bundle through `vite preview` (same
      // output nginx serves, `/api` proxied); local runs use the dev server
      // and reuse an already running one when `pnpm dev` is up.
      command: IS_CI
        ? `pnpm --filter @localdeck/ui preview --host 127.0.0.1 --port ${uiPort} --strictPort`
        : `pnpm --filter @localdeck/ui dev --host 127.0.0.1 --port ${uiPort} --strictPort`,
      cwd: REPO_ROOT,
      url: `${uiOrigin}/`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        VITE_DEV_API_PROXY_TARGET: apiOrigin,
      },
    },
  ],
});
