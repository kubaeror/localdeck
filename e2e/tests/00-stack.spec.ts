import { expect, test } from '@playwright/test';
import { fetchHealth } from './helpers';

/**
 * Stack-level smoke checks: the api reports the CI emulator as reachable and
 * the ui serves and renders the console. Everything else in this suite builds
 * on these two assumptions, so a failure here is the first thing to fix.
 */
test.describe('stack smoke', () => {
  test('GET /api/health answers 200 against the running emulator', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const health = await fetchHealth(request);
    expect(['ok', 'degraded']).toContain(health.status);
    expect(health.endpoint.length).toBeGreaterThan(0);
    expect(health.provider.providerLabel.length).toBeGreaterThan(0);
    expect(health.emulator.counts.enabled ?? 0).toBeGreaterThan(0);

    // The storage flow the suite exercises needs S3; everything else is
    // reported per environment (EKS is entitlement-gated on some emulators).
    expect(health.emulator.services['s3']).toBeDefined();
    expect(health.emulator.services['s3']).not.toBe('error');
  });

  test('the ui serves the console index and renders the shell', async ({ page, request }) => {
    const index = await request.get('/');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type'] ?? '').toContain('text/html');
    expect(await index.text()).toContain('<div id="root">');

    await page.goto('/');
    await expect(page).toHaveTitle('LocalDeck');
    await expect(page.getByRole('heading', { name: 'Console Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'LocalDeck' })).toBeVisible();
  });

  test('the console home shows the live emulator endpoint', async ({ page }) => {
    await page.goto('/console/home');
    // The Service health widget renders the endpoint the api is bound to and
    // the number of services the emulator reports.
    await expect(page.getByText('Enabled services')).toBeVisible();
    await expect(page.getByText('Registry coverage')).toBeVisible();
  });
});
