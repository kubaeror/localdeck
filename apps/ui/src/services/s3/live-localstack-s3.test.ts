// @vitest-environment node
/**
 * Live S3 module client test against the *running* LocalDeck api and the
 * external LocalStack it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * The test drives the module's own `api.ts` (the same calls the console makes):
 * create bucket → upload (small and multipart) → browse folders → download
 * through the presigned-URL proxy → bucket policy (invalid documents rejected
 * by the editor's validation) → delete. Versioning/tags/Block Public Access run
 * in a second, empty bucket so no delete markers block bucket deletion.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  copyObject,
  createBucket,
  createFolder,
  deleteBucket,
  deleteFolder,
  deleteObjects,
  downloadObjectUrl,
  getBucketPolicy,
  getBucketTags,
  getBucketVersioning,
  getPublicAccessBlock,
  headObject,
  listBuckets,
  listObjects,
  putBucketPolicy,
  putBucketTags,
  putBucketVersioning,
  putPublicAccessBlock,
  uploadObject,
} from './api';
import { validateBucketPolicy } from './policy';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

/** Prefixes relative api paths with the live api base, like the dev proxy. */
function installLiveFetch(): void {
  const base = API_BASE ?? '';
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
    ),
  );
}

const stamp = Date.now().toString(36);
const bucketName = `localdeck-ui-live-${stamp}`;
const settingsBucket = `${bucketName}-settings`;
const reportKey = 'folder/live-report.txt';
const reportBody = 'LocalDeck live UI client verification\n';
const largeKey = 'large/live-multipart.bin';
const largeBody = new Uint8Array(8 * 1024 * 1024 + 512).fill(0x62);
const specialKey = 'folder/unicode %?#& é.txt';
const specialCopyKey = 'folder/unicode-copy.txt';

liveDescribe('S3 module against the live api and LocalStack', () => {
  beforeAll(() => {
    installLiveFetch();
  });

  afterAll(async () => {
    // Best-effort cleanup, even when an assertion failed earlier.
    for (const bucket of [bucketName, settingsBucket]) {
      try {
        await deleteObjects({
          bucket,
          keys: [reportKey, largeKey, specialKey, specialCopyKey],
        });
      } catch {
        // Ignore: the bucket may not exist.
      }
      try {
        await deleteBucket(bucket);
      } catch {
        // Ignore: the bucket may not exist.
      }
    }
    vi.unstubAllGlobals();
  });

  it('runs the console acceptance flow end to end', async () => {
    // 1. Create the bucket the way the wizard does (tags and Block Public
    //    Access applied as follow-up calls).
    await createBucket({
      name: bucketName,
      region: 'us-east-1',
      versioning: false,
      tags: [{ Key: 'env', Value: 'live-test' }],
      blockPublicAccess: true,
    });

    const buckets = await listBuckets();
    expect(buckets.items.some((bucket) => bucket.name === bucketName)).toBe(true);

    // 2. Upload a small object and a large one (S3 multipart path).
    const small = await uploadObject({
      bucket: bucketName,
      key: reportKey,
      file: new File([reportBody], 'live-report.txt', { type: 'text/plain' }),
    });
    expect(small).toMatchObject({ key: reportKey, size: reportBody.length, multipart: false });

    const large = await uploadObject({
      bucket: bucketName,
      key: largeKey,
      file: new File([largeBody], 'live-multipart.bin', { type: 'application/octet-stream' }),
    });
    expect(large.multipart).toBe(true);
    expect(large.size).toBe(largeBody.length);

    // 3. Browse folders with the console's Delimiter: '/' semantics.
    const root = await listObjects({ bucket: bucketName });
    expect(root.folders.map((folder) => folder.key)).toEqual(
      expect.arrayContaining(['folder/', 'large/']),
    );
    const folder = await listObjects({ bucket: bucketName, prefix: 'folder/' });
    expect(folder.objects.map((object) => object.name)).toEqual(['live-report.txt']);
    expect(folder.objects[0]?.size).toBe(reportBody.length);

    // 4. Metadata view (HeadObject).
    const metadata = await headObject({ bucket: bucketName, key: reportKey });
    expect(metadata.size).toBe(reportBody.length);
    expect(metadata.contentType).toBe('text/plain');

    // 5. Download through the presigned-URL proxy.
    const download = await fetch(downloadObjectUrl({ bucket: bucketName, key: reportKey }));
    expect(download.status).toBe(200);
    expect(download.headers.get('x-localdeck-download-mode')).toBe('presigned-proxy');
    expect(await download.text()).toBe(reportBody);

    // 6. Permissions: the policy editor's structure validation rejects an
    //    invalid document before any request leaves the browser.
    const invalid = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow"}]}';
    const validation = validateBucketPolicy(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.structureErrors.join(' ')).toContain('Principal');

    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'LocalDeckLiveRead',
          Effect: 'Allow',
          Principal: { AWS: 'arn:aws:iam::000000000000:root' },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/*`],
        },
      ],
    });
    await putBucketPolicy({ bucket: bucketName, policy });
    expect(await getBucketPolicy(bucketName)).toContain('LocalDeckLiveRead');

    // 7. Properties in a second, empty bucket: versioning, tags, BPA.
    await createBucket({
      name: settingsBucket,
      region: 'eu-west-1',
      versioning: true,
      tags: [],
      blockPublicAccess: false,
    });
    expect((await getBucketVersioning(settingsBucket)).status).toBe('Enabled');
    await putBucketVersioning({ bucket: settingsBucket, enabled: false });
    expect((await getBucketVersioning(settingsBucket)).status).toBe('Suspended');

    expect(await getBucketTags(settingsBucket)).toEqual([]);
    await putBucketTags({ bucket: settingsBucket, tags: [{ Key: 'env', Value: 'live' }] });
    expect((await getBucketTags(settingsBucket))[0]).toEqual({ Key: 'env', Value: 'live' });

    const access = await getPublicAccessBlock(settingsBucket);
    expect(access.BlockPublicPolicy).toBe(false);
    await putPublicAccessBlock({
      bucket: settingsBucket,
      settings: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    });
    expect((await getPublicAccessBlock(settingsBucket)).BlockPublicPolicy).toBe(true);
    await deleteBucket(settingsBucket);

    // 8. Folder markers: nested zero-byte keys are real folders to S3, and
    //    deleting the folder must remove the markers themselves too.
    await createFolder({ bucket: bucketName, prefix: '', name: 'live-folder' });
    await createFolder({ bucket: bucketName, prefix: 'live-folder/', name: 'nested' });
    const withFolder = await listObjects({ bucket: bucketName });
    expect(withFolder.folders.map((folder) => folder.key)).toContain('live-folder/');

    const folderDelete = await deleteFolder({ bucket: bucketName, prefix: 'live-folder/' });
    expect(folderDelete.failures).toEqual([]);
    expect(folderDelete.deleted).toEqual(
      expect.arrayContaining(['live-folder/', 'live-folder/nested/']),
    );
    const afterFolderDelete = await listObjects({ bucket: bucketName });
    expect(afterFolderDelete.folders.map((folder) => folder.key)).not.toContain('live-folder/');

    // 9. Special characters in object keys round-trip through CopySource.
    await uploadObject({
      bucket: bucketName,
      key: specialKey,
      file: new File(['special'], 'special.txt', { type: 'text/plain' }),
    });
    await copyObject({
      sourceBucket: bucketName,
      sourceKey: specialKey,
      destinationBucket: bucketName,
      destinationKey: specialCopyKey,
    });
    expect((await headObject({ bucket: bucketName, key: specialCopyKey })).size).toBe(7);

    // 10. Delete: objects first, then the bucket.
    const deleted = await deleteObjects({
      bucket: bucketName,
      keys: [reportKey, largeKey, specialKey, specialCopyKey],
    });
    expect(deleted.failures).toEqual([]);
    await deleteBucket(bucketName);
    expect((await listBuckets()).items.some((bucket) => bucket.name === bucketName)).toBe(false);

    // The generous timeout covers the 8 MiB multipart upload round trip.
  }, 120_000);
});
