import { createServiceSpec } from '@localdeck/shared';

/**
 * S3 capability metadata.
 *
 * `operations` must stay a subset of the registry whitelist in
 * `packages/shared/src/services.ts`; `createServiceSpec` throws at module load
 * otherwise, and the api rejects anything else with 400 before the SDK runs.
 * Object bytes travel through the two dedicated proxy routes
 * (`api.ts` → `uploadObject`/`downloadObjectUrl`), whose underlying operations
 * are on this list as well.
 */
export const spec = createServiceSpec('s3', {
  operations: [
    // Buckets
    'ListBuckets',
    'CreateBucket',
    'DeleteBucket',
    'GetBucketLocation',
    // Objects
    'ListObjectsV2',
    'PutObject',
    'HeadObject',
    'DeleteObject',
    'DeleteObjects',
    'CopyObject',
    // Versioning
    'GetBucketVersioning',
    'PutBucketVersioning',
    // Tags
    'GetBucketTagging',
    'PutBucketTagging',
    'DeleteBucketTagging',
    // Permissions
    'GetBucketPolicy',
    'PutBucketPolicy',
    'DeleteBucketPolicy',
    'GetPublicAccessBlock',
    'PutPublicAccessBlock',
    'DeletePublicAccessBlock',
    // Encryption
    'GetBucketEncryption',
  ],
  capabilities: { list: true, detail: true, create: true },
});

export const SERVICE_ID = spec.descriptor.id;

/** Operation the list page calls. */
export const LIST_OPERATION = 'ListBuckets';
