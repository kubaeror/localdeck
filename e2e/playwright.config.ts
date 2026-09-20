import { defineConfig, devices } from '@playwright/test';
import {
  API_ORIGIN,
  API_PORT,
  IS_CI,
  LOCALSTACK_ENDPOINT,
  REPO_ROOT,
  UI_ORIGIN,
  UI_PORT,
} from './support';

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
export default defineConfig({
  testDir: './tests',
  // The shipped-container spec needs `docker compose up` and its own config;
  // it must never run inside the regular api+ui smoke job.
  testIgnore: ['**/container/**'],
  outputDir: './test-results',
  /* The smoke suite creates real resources in one LocalStack, so it runs in a
     single worker and stays order-independent (every test cleans up after
     itself). */
  fullyParallel: false,
  workers: 1,
  forbidOnly: IS_CI,
  /* Retries stay for read-only checks; every spec that mutates the emulator
     opts out with `test.describe.configure({ retries: 0 })` so a failed
     cleanup can never create a duplicate resource. */
  retries: IS_CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: IS_CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: UI_ORIGIN,
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
      url: `${API_ORIGIN}/api/health/live`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        LOCALSTACK_ENDPOINT,
        LOG_LEVEL: 'warn',
        LOG_PRETTY: 'false',
        // The suite intentionally exercises many routes in a burst; the
        // production rate budget must not make smoke tests flaky.
        RATE_LIMIT_MAX: '100000',
      },
    },
    {
      // CI smoke-tests the production bundle through `vite preview` (same
      // output nginx serves, `/api` proxied); local runs use the dev server
      // and reuse an already running one when `pnpm dev` is up. The shipped
      // nginx image is exercised by `pnpm test:e2e:container`.
      command: IS_CI
        ? `pnpm --filter @localdeck/ui preview --host 127.0.0.1 --port ${UI_PORT} --strictPort`
        : `pnpm --filter @localdeck/ui dev --host 127.0.0.1 --port ${UI_PORT} --strictPort`,
      cwd: REPO_ROOT,
      url: `${UI_ORIGIN}/`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        VITE_DEV_API_PROXY_TARGET: API_ORIGIN,
      },
    },
  ],
});
