import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { REPO_ROOT, uniqueName } from './helpers';

/**
 * The api's error contracts, exercised over HTTP exactly like the console does.
 * These are the guarantees the ui renders as honest, actionable states:
 * unknown service → 404, non-whitelisted operation → 400, missing SDK package
 * → 501, and an unreachable emulator → 503 with the shared ApiError shape.
 */

interface ApiErrorBody {
  error: { code: string; message: string; statusCode: number; details?: Record<string, unknown> };
}

test.describe('api error contracts', () => {
  test.describe.configure({ retries: 0 });

  test('unknown service answers 404 with the shared error shape', async ({ request }) => {
    const response = await request.post(
      `/api/services/${encodeURIComponent(`localdeck-missing-${uniqueName('svc')}`)}/ListThings`,
      { data: { input: {} } },
    );
    expect(response.status()).toBe(404);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.statusCode).toBe(404);
    // The registry route currently emits the generic NOT_FOUND; the shared
    // catalogue also defines SERVICE_NOT_REGISTERED for this case. Accept both
    // so tightening the code later does not break the contract test.
    expect(['NOT_FOUND', 'SERVICE_NOT_REGISTERED']).toContain(body.error.code);
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  test('non-whitelisted operation answers 400 before any SDK call', async ({ request }) => {
    const response = await request.post('/api/services/s3/NotAWhitelistedOperation', {
      data: { input: {} },
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe('OPERATION_NOT_WHITELISTED');
    expect(body.error.statusCode).toBe(400);
    expect(Array.isArray(body.error.details?.allowedOperations)).toBe(true);
  });

  test('service without an installed SDK package answers 501', async ({ request }) => {
    // Bedrock is in the registry with whitelisted operations, but
    // @aws-sdk/client-bedrock is deliberately not a dependency of the api.
    const response = await request.post('/api/services/bedrock/ListFoundationModels', {
      data: { input: {} },
    });
    if (response.status() === 200) {
      test.skip(
        true,
        'The api now ships @aws-sdk/client-bedrock; point this assertion at another uninstalled package.',
      );
    }
    expect(response.status()).toBe(501);
    const body = (await response.json()) as ApiErrorBody;
    expect(body.error.code).toBe('SDK_PACKAGE_UNAVAILABLE');
    expect(body.error.statusCode).toBe(501);
    expect(body.error.details?.sdkPackage).toBe('@aws-sdk/client-bedrock');
  });

  test('an unreachable emulator answers 503 with EMULATOR_UNREACHABLE', async () => {
    test.setTimeout(120_000);
    const port = Number.parseInt(process.env.E2E_DOWN_API_PORT ?? '3999', 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('E2E_DOWN_API_PORT must be an integer port');
    }
    const origin = `http://127.0.0.1:${port}`;
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

    const child = spawn(command, ['exec', 'tsx', 'apps/api/src/index.ts'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: String(port),
        // Port 9 (discard) never accepts connections: a deterministic refusal.
        EMULATOR_ENDPOINT: 'http://127.0.0.1:9',
        LOCALSTACK_TIMEOUT_MS: '2000',
        LOG_LEVEL: 'warn',
        LOG_PRETTY: 'false',
      },
      stdio: 'ignore',
    });

    try {
      await waitForLiveness(origin);
      const response = await fetch(`${origin}/api/health`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as ApiErrorBody;
      expect(body.error.code).toBe('EMULATOR_UNREACHABLE');
      expect(body.error.statusCode).toBe(503);
      expect(body.error.details?.endpoint).toBe('http://127.0.0.1:9');
      expect(typeof body.error.details?.reason).toBe('string');
    } finally {
      child.kill('SIGTERM');
    }
  });
});

async function waitForLiveness(origin: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${origin}/api/health/live`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(`the api did not become live at ${origin} within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
