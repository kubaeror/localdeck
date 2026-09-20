import { expect, test } from '@playwright/test';
import {
  E2E_RESOURCE_PREFIX,
  callServiceOperation,
  deleteBucketIfExists,
  uniqueName,
} from '../helpers';

/**
 * Smoke for the images `docker compose` ships. Unlike the main suite (which
 * runs the Vite dev server or `vite preview`), this project talks to nginx
 * serving the production bundle and proxying /api — the path a user following
 * the Quick start takes. The upload below is larger than nginx's 1 MiB default
 * `client_max_body_size`, so a regression in `nginx.conf.template` fails CI.
 */
test.describe('containerized console', () => {
  test('serves the console through nginx and proxies the api', async ({ page, request }) => {
    const healthz = await request.get('/healthz');
    expect(healthz.status()).toBe(200);
    expect(await healthz.text()).toContain('ok');

    const index = await request.get('/');
    expect(index.status()).toBe(200);
    expect(index.headers()['content-type'] ?? '').toContain('text/html');
    expect(await index.text()).toContain('<div id="root">');

    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);

    await page.goto('/');
    await expect(page).toHaveTitle('LocalDeck');
    await expect(page.getByRole('heading', { name: 'Console Home' })).toBeVisible();
  });

  test('uploads and downloads an object larger than the nginx 1 MiB default', async ({
    request,
  }) => {
    const bucket = uniqueName(`${E2E_RESOURCE_PREFIX}-container`);
    const key = 'large/payload.bin';
    const payload = Buffer.alloc(1_572_864, 7); // 1.5 MiB > nginx's 1 MiB default

    try {
      await callServiceOperation(request, 's3', 'CreateBucket', { Bucket: bucket });

      const upload = await request.post(
        `/api/services/s3/objects/upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
        {
          multipart: {
            file: {
              name: 'payload.bin',
              mimeType: 'application/octet-stream',
              buffer: payload,
            },
          },
        },
      );
      expect(
        upload.status(),
        `nginx must forward bodies above its 1 MiB default; got ${upload.status()}`,
      ).toBe(201);
      const uploaded = (await upload.json()) as { upload: { size: number } };
      expect(uploaded.upload.size).toBe(payload.byteLength);

      const download = await request.get(
        `/api/services/s3/objects/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      );
      expect(download.status()).toBe(200);
      expect(download.headers()['x-localdeck-download-mode']).toBe('sdk-stream');
      const downloaded = await download.body();
      expect(downloaded.byteLength).toBe(payload.byteLength);
      expect(downloaded.equals(payload)).toBe(true);
    } finally {
      await deleteBucketIfExists(request, bucket);
    }
  });
});
