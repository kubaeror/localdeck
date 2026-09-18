import { expect, test } from '@playwright/test';
import {
  E2E_RESOURCE_PREFIX,
  callServiceOperation,
  deleteBucketIfExists,
  trackResource,
  uniqueName,
} from './helpers';

/**
 * The two S3-specific api routes carry object bytes, which the JSON dispatcher
 * cannot: a multipart upload that streams into LocalStack and a download that
 * proxies the presigned URL back. Both are part of the flagship object browser
 * flow, so they get their own end-to-end check against the real emulator.
 */
test.describe('s3 object upload and download', () => {
  test.describe.configure({ retries: 0 });

  test('uploads and downloads an object through the api proxy routes', async ({ request }) => {
    const bucket = uniqueName(`${E2E_RESOURCE_PREFIX}-objects`);
    const key = 'docs/payload.bin';
    const payload = Buffer.alloc(128 * 1024, 'localdeck-object-content');

    try {
      await callServiceOperation(request, 's3', 'CreateBucket', { Bucket: bucket });
      trackResource('s3-bucket', bucket);

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
      expect(upload.status()).toBe(201);
      const uploaded = (await upload.json()) as { upload: { size: number } };
      expect(uploaded.upload.size).toBe(payload.byteLength);

      const download = await request.get(
        `/api/services/s3/objects/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      );
      expect(download.status()).toBe(200);
      expect(download.headers()['x-localdeck-download-mode']).toBe('presigned-proxy');
      const downloaded = await download.body();
      expect(downloaded.byteLength).toBe(payload.byteLength);
      expect(downloaded.equals(payload)).toBe(true);

      // The object is visible to the same dispatcher the console's object
      // browser uses.
      const listed = await callServiceOperation<{ Contents?: { Key?: string }[] }>(
        request,
        's3',
        'ListObjectsV2',
        { Bucket: bucket, Prefix: 'docs/' },
      );
      expect((listed.Contents ?? []).map((entry) => entry.Key)).toContain(key);
    } finally {
      await deleteBucketIfExists(request, bucket);
    }
  });

  test('answers a missing key with the S3 error contract', async ({ request }) => {
    const bucket = uniqueName(`${E2E_RESOURCE_PREFIX}-objects`);
    try {
      await callServiceOperation(request, 's3', 'CreateBucket', { Bucket: bucket });
      trackResource('s3-bucket', bucket);

      const download = await request.get(
        `/api/services/s3/objects/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent('missing.bin')}`,
      );
      expect(download.status()).toBe(404);
      const body = (await download.json()) as { error: { code: string; statusCode: number } };
      expect(body.error.statusCode).toBe(404);
      expect(body.error.code).toMatch(/nosuchkey|no such key/i);
    } finally {
      await deleteBucketIfExists(request, bucket);
    }
  });
});
