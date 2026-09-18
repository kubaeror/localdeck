import {
  S3_PUBLIC_ACCESS_ALL_BLOCKED,
  S3_PUBLIC_ACCESS_DEFAULTS,
  s3DownloadPath,
  s3UploadPath,
  type AwsTag,
  type Paginated,
  type S3PublicAccessBlock,
  type S3UploadResponse,
} from '@localdeck/shared';
import { apiUrl, postMultipart } from '../../lib/apiClient';
import { callServiceOperation } from '../../lib/serviceOperations';
import { annotateS3Error, isS3Code, type FriendlyS3Error, toFriendlyS3Error } from './errors';
import { needsLocationConstraint, normalizePrefix, validateObjectKey } from './naming';
import { LIST_OPERATION, SERVICE_ID } from './spec';

/**
 * Typed S3 calls.
 *
 * Everything that fits the api's JSON dispatcher goes through
 * `callServiceOperation`; object bytes use the two dedicated proxy routes
 * (`postMultipart` for uploads, a same-origin link for downloads). The browser
 * never sees credentials and never talks to LocalStack.
 */

// ---------------------------------------------------------------- buckets

/** One bucket row on the list page. */
export interface S3Bucket {
  name: string;
  /** ISO timestamp from ListBuckets. */
  creationDate?: string;
  /** The raw SDK object, for JSON views. */
  raw: Record<string, unknown>;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export interface ListBucketsOptions {
  signal?: AbortSignal;
}

interface RawBucket {
  Name?: string;
  CreationDate?: Date | string;
}

/** `ListBuckets` — every bucket the LocalStack account owns. */
export async function listBuckets(options: ListBucketsOptions = {}): Promise<Paginated<S3Bucket>> {
  const result = await callServiceOperation<{ Buckets?: RawBucket[] }>(
    SERVICE_ID,
    LIST_OPERATION,
    {},
    options.signal,
  );
  const items = (result.Buckets ?? []).flatMap((bucket): S3Bucket[] => {
    if (typeof bucket.Name !== 'string' || bucket.Name.length === 0) return [];
    const creationDate = toIso(bucket.CreationDate);
    return [
      {
        name: bucket.Name,
        ...(creationDate === undefined ? {} : { creationDate }),
        raw: bucket as Record<string, unknown>,
      },
    ];
  });
  return { items };
}

export interface CreateBucketInput {
  name: string;
  region: string;
  /** Start the bucket with versioning enabled. */
  versioning: boolean;
  tags: readonly AwsTag[];
  /** Block all public access (the console's recommended default). */
  blockPublicAccess: boolean;
}

/**
 * The create wizard's submit: CreateBucket plus the optional settings, in the
 * order the console applies them. A failure after the bucket exists names the
 * step that failed instead of pretending nothing happened.
 */
export async function createBucket(input: CreateBucketInput): Promise<void> {
  const createInput: Record<string, unknown> = { Bucket: input.name };
  if (needsLocationConstraint(input.region)) {
    createInput['CreateBucketConfiguration'] = { LocationConstraint: input.region };
  }
  await callServiceOperation(SERVICE_ID, 'CreateBucket', createInput);

  if (input.versioning) {
    try {
      await putBucketVersioning({ bucket: input.name, enabled: true });
    } catch (error) {
      throw annotateS3Error(error, `Bucket "${input.name}" was created, but versioning failed.`);
    }
  }

  if (input.tags.length > 0) {
    try {
      await putBucketTags({ bucket: input.name, tags: input.tags });
    } catch (error) {
      throw annotateS3Error(error, `Bucket "${input.name}" was created, but tagging failed.`);
    }
  }

  try {
    await putPublicAccessBlock({
      bucket: input.name,
      settings: input.blockPublicAccess ? S3_PUBLIC_ACCESS_ALL_BLOCKED : S3_PUBLIC_ACCESS_DEFAULTS,
    });
  } catch (error) {
    throw annotateS3Error(
      error,
      `Bucket "${input.name}" was created, but the Block Public Access settings failed.`,
    );
  }
}

export async function deleteBucket(bucket: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteBucket', { Bucket: bucket });
}

export interface BulkDeleteResult {
  deleted: readonly string[];
  failures: readonly { bucket: string; error: FriendlyS3Error }[];
}

/** Deletes buckets one by one, reporting the failures instead of stopping. */
export async function deleteBuckets(buckets: readonly string[]): Promise<BulkDeleteResult> {
  const deleted: string[] = [];
  const failures: { bucket: string; error: FriendlyS3Error }[] = [];
  for (const bucket of buckets) {
    try {
      await deleteBucket(bucket);
      deleted.push(bucket);
    } catch (error) {
      failures.push({ bucket, error: toFriendlyS3Error(error) });
    }
  }
  return { deleted, failures };
}

/** `GetBucketLocation`; us-east-1 reports as an empty LocationConstraint. */
export async function getBucketLocation(bucket: string, signal?: AbortSignal): Promise<string> {
  const result = await callServiceOperation<{ LocationConstraint?: string | null }>(
    SERVICE_ID,
    'GetBucketLocation',
    { Bucket: bucket },
    signal,
  );
  const location = result.LocationConstraint;
  return typeof location === 'string' && location.length > 0 ? location : 'us-east-1';
}

// ---------------------------------------------------------------- objects

/** One row in the object browser: a folder or an object. */
export interface S3ObjectEntry {
  kind: 'folder' | 'object';
  /** Full key. Folder keys end with `/`. */
  key: string;
  /** Display name relative to the current prefix. */
  name: string;
  size?: number;
  lastModified?: string;
  storageClass?: string;
  etag?: string;
}

export interface S3ObjectPage {
  folders: readonly S3ObjectEntry[];
  objects: readonly S3ObjectEntry[];
  /** Pass back as `continuationToken` for the next page. */
  nextToken?: string;
}

export interface ListObjectsInput {
  bucket: string;
  /** Folder prefix, usually ending with `/`; `''` lists the bucket root. */
  prefix?: string;
  continuationToken?: string;
  /** Omit the delimiter to walk every key under the prefix (folder deletes). */
  recursive?: boolean;
  signal?: AbortSignal;
}

interface RawObject {
  Key?: string;
  Size?: number;
  LastModified?: Date | string;
  StorageClass?: string;
  ETag?: string;
}

/**
 * `ListObjectsV2` with `Delimiter: '/'`, the console's folder semantics:
 * prefixes come back as folders, keys as objects. The folder placeholder key
 * (the prefix itself) is never shown as an object.
 */
export async function listObjects(input: ListObjectsInput): Promise<S3ObjectPage> {
  const prefix = input.prefix ?? '';
  const continuationToken = input.continuationToken;
  const result = await callServiceOperation<{
    CommonPrefixes?: { Prefix?: string }[];
    Contents?: RawObject[];
    NextContinuationToken?: string;
    IsTruncated?: boolean;
  }>(
    SERVICE_ID,
    'ListObjectsV2',
    {
      Bucket: input.bucket,
      ...(input.recursive === true ? {} : { Delimiter: '/' }),
      ...(prefix.length === 0 ? {} : { Prefix: prefix }),
      ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
    },
    input.signal,
  );

  const folders = (result.CommonPrefixes ?? []).flatMap((entry): S3ObjectEntry[] => {
    const key = entry.Prefix ?? '';
    if (key.length === 0) return [];
    return [{ kind: 'folder', key, name: key.slice(prefix.length) }];
  });

  const folderKeys = new Set(folders.map((folder) => folder.key));
  const objects = (result.Contents ?? []).flatMap((entry): S3ObjectEntry[] => {
    const key = entry.Key ?? '';
    // The folder placeholder itself and keys that are already common prefixes
    // stay out of the object list.
    if (key.length === 0 || key === prefix || key.endsWith('/') || folderKeys.has(key)) return [];
    const lastModified = toIso(entry.LastModified);
    return [
      {
        kind: 'object',
        key,
        name: key.slice(prefix.length),
        ...(typeof entry.Size === 'number' ? { size: entry.Size } : {}),
        ...(lastModified === undefined ? {} : { lastModified }),
        ...(typeof entry.StorageClass === 'string' ? { storageClass: entry.StorageClass } : {}),
        ...(typeof entry.ETag === 'string' ? { etag: entry.ETag } : {}),
      },
    ];
  });

  const nextToken = result.NextContinuationToken;
  return {
    folders,
    objects,
    ...(nextToken === undefined || nextToken.length === 0 ? {} : { nextToken }),
  };
}

/** Creates the zero-byte object that represents a folder. */
export async function createFolder(input: {
  bucket: string;
  prefix: string;
  name: string;
}): Promise<void> {
  const key = `${normalizePrefix(input.prefix)}${input.name.replace(/\/+$/, '')}/`;
  const problem = validateObjectKey(key);
  if (problem !== null) throw new Error(problem);
  await callServiceOperation(SERVICE_ID, 'PutObject', {
    Bucket: input.bucket,
    Key: key,
    Body: '',
  });
}

export async function deleteObject(input: { bucket: string; key: string }): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteObject', {
    Bucket: input.bucket,
    Key: input.key,
  });
}

/** One failure from a `DeleteObjects` batch. */
export interface DeleteObjectsFailure {
  /**
   * The object key AWS named, or a summary for a whole batch that failed
   * before S3 could answer per key (a network or proxy error).
   */
  key: string;
  code?: string;
  message?: string;
}

export interface DeleteObjectsResult {
  deleted: readonly string[];
  failures: readonly DeleteObjectsFailure[];
}

function batchFailureLabel(batch: readonly string[]): string {
  const first = batch[0] ?? '(unknown)';
  return batch.length === 1 ? first : `${batch.length} objects (starting at "${first}")`;
}

/**
 * `DeleteObjects` in batches of 1000 (the API maximum). Each batch is caught
 * on its own, so a failure on page N never discards the keys that were already
 * deleted and never blocks the remaining batches.
 */
export async function deleteObjects(input: {
  bucket: string;
  keys: readonly string[];
  signal?: AbortSignal;
}): Promise<DeleteObjectsResult> {
  const deleted: string[] = [];
  const failures: DeleteObjectsFailure[] = [];

  for (let offset = 0; offset < input.keys.length; offset += 1000) {
    const batch = input.keys.slice(offset, offset + 1000);
    try {
      const result = await callServiceOperation<{
        Deleted?: { Key?: string }[];
        Errors?: { Key?: string; Code?: string; Message?: string }[];
      }>(
        SERVICE_ID,
        'DeleteObjects',
        {
          Bucket: input.bucket,
          Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: false },
        },
        input.signal,
      );

      for (const entry of result.Deleted ?? []) {
        if (typeof entry.Key === 'string') deleted.push(entry.Key);
      }
      for (const entry of result.Errors ?? []) {
        failures.push({
          key: entry.Key ?? '(unknown)',
          ...(entry.Code === undefined ? {} : { code: entry.Code }),
          ...(entry.Message === undefined ? {} : { message: entry.Message }),
        });
      }
    } catch (caught) {
      if (input.signal?.aborted === true) throw caught;
      const friendly = toFriendlyS3Error(caught);
      failures.push({
        key: batchFailureLabel(batch),
        code: friendly.apiError.code,
        message: friendly.message,
      });
    }
  }

  return { deleted, failures };
}

export interface CopyObjectInput {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
}

/** `CopySource` needs every key segment percent-encoded, but not the slashes. */
function encodeCopySource(bucket: string, key: string): string {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `/${encodeURIComponent(bucket)}/${encodedKey}`;
}

/** `CopyObject`; the source is a cross-bucket-safe `/{bucket}/{key}` source. */
export async function copyObject(input: CopyObjectInput): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'CopyObject', {
    Bucket: input.destinationBucket,
    Key: input.destinationKey,
    CopySource: encodeCopySource(input.sourceBucket, input.sourceKey),
  });
}

/** Copy then delete, which is what the console's "move" does. */
export async function moveObject(input: CopyObjectInput): Promise<void> {
  await copyObject(input);
  if (input.sourceBucket === input.destinationBucket && input.sourceKey === input.destinationKey) {
    return;
  }
  await deleteObject({ bucket: input.sourceBucket, key: input.sourceKey });
}

/**
 * Deletes a folder and everything under it, the way the console's "Delete
 * folder" does. The recursive listing includes the prefix marker itself and
 * every nested folder marker (S3 returns keys that end with a slash as regular
 * keys when no delimiter is set), and each page is deleted as it arrives so a
 * huge folder does not have to fit in memory.
 */
export async function deleteFolder(input: {
  bucket: string;
  prefix: string;
  signal?: AbortSignal;
}): Promise<DeleteObjectsResult> {
  const deleted: string[] = [];
  const failures: DeleteObjectsFailure[] = [];
  let continuationToken: string | undefined;
  let firstPage = true;

  do {
    const result = await callServiceOperation<{
      Contents?: RawObject[];
      NextContinuationToken?: string;
    }>(
      SERVICE_ID,
      'ListObjectsV2',
      {
        Bucket: input.bucket,
        ...(input.prefix.length === 0 ? {} : { Prefix: input.prefix }),
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      },
      input.signal,
    );

    const keys = new Set<string>();
    // The folder marker itself may not come back from a listing whose prefix
    // starts after it; delete it explicitly so an "empty" folder disappears.
    if (firstPage && input.prefix.length > 0) keys.add(input.prefix);
    for (const entry of result.Contents ?? []) {
      if (typeof entry.Key === 'string' && entry.Key.length > 0) keys.add(entry.Key);
    }

    if (keys.size > 0) {
      const page = await deleteObjects({
        bucket: input.bucket,
        keys: [...keys],
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      deleted.push(...page.deleted);
      failures.push(...page.failures);
    }

    firstPage = false;
    const next = result.NextContinuationToken;
    continuationToken = next === undefined || next.length === 0 ? undefined : next;
  } while (continuationToken !== undefined);

  return { deleted, failures };
}

/** Object metadata (HeadObject) as the metadata modal renders it. */
export interface S3ObjectMetadata {
  bucket: string;
  key: string;
  size?: number;
  lastModified?: string;
  etag?: string;
  contentType?: string;
  contentEncoding?: string;
  cacheControl?: string;
  contentDisposition?: string;
  storageClass?: string;
  versionId?: string;
  /** User metadata without the `x-amz-meta-` prefix. */
  metadata: Readonly<Record<string, string>>;
  /** The raw SDK response, for the JSON view. */
  raw: Record<string, unknown>;
}

interface RawHeadObject {
  ContentLength?: number;
  LastModified?: Date | string;
  ETag?: string;
  ContentType?: string;
  ContentEncoding?: string;
  CacheControl?: string;
  ContentDisposition?: string;
  StorageClass?: string;
  VersionId?: string;
  Metadata?: Record<string, string>;
}

export async function headObject(input: {
  bucket: string;
  key: string;
  versionId?: string;
  signal?: AbortSignal;
}): Promise<S3ObjectMetadata> {
  const result = await callServiceOperation<RawHeadObject>(
    SERVICE_ID,
    'HeadObject',
    {
      Bucket: input.bucket,
      Key: input.key,
      ...(input.versionId === undefined ? {} : { VersionId: input.versionId }),
    },
    input.signal,
  );
  const lastModified = toIso(result.LastModified);
  return {
    bucket: input.bucket,
    key: input.key,
    ...(typeof result.ContentLength === 'number' ? { size: result.ContentLength } : {}),
    ...(lastModified === undefined ? {} : { lastModified }),
    ...(result.ETag === undefined ? {} : { etag: result.ETag }),
    ...(result.ContentType === undefined ? {} : { contentType: result.ContentType }),
    ...(result.ContentEncoding === undefined ? {} : { contentEncoding: result.ContentEncoding }),
    ...(result.CacheControl === undefined ? {} : { cacheControl: result.CacheControl }),
    ...(result.ContentDisposition === undefined
      ? {}
      : { contentDisposition: result.ContentDisposition }),
    ...(result.StorageClass === undefined ? {} : { storageClass: result.StorageClass }),
    ...(result.VersionId === undefined ? {} : { versionId: result.VersionId }),
    metadata: result.Metadata ?? {},
    raw: result as Record<string, unknown>,
  };
}

// ------------------------------------------------- uploads and downloads

/** Uploads one file through the api's multipart proxy. */
export async function uploadObject(input: {
  bucket: string;
  key: string;
  file: File;
  signal?: AbortSignal;
}): Promise<S3UploadResponse['upload']> {
  const response = await postMultipart<S3UploadResponse>(
    s3UploadPath({ bucket: input.bucket, key: input.key }),
    input.file,
    input.signal,
  );
  return response.upload;
}

/**
 * Same-origin url of the download proxy. The api presigns a LocalStack
 * GetObject URL and streams the response, so the browser can use this as a
 * plain link.
 */
export function downloadObjectUrl(input: {
  bucket: string;
  key: string;
  versionId?: string;
}): string {
  return apiUrl(
    s3DownloadPath({
      bucket: input.bucket,
      key: input.key,
      ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
    }),
  );
}

/**
 * Starts a browser download for a same-origin url. An anchor click is used
 * (instead of `window.open`) so the browser keeps it in the current tab and a
 * popup blocker never interferes.
 */
export function triggerDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// ------------------------------------------------------------- versioning

export type S3VersioningStatus = 'Enabled' | 'Suspended' | 'Unversioned';

export interface S3BucketVersioning {
  status: S3VersioningStatus;
  /** MFA delete can only be changed by the account root user. */
  mfaDelete: boolean;
}

export async function getBucketVersioning(
  bucket: string,
  signal?: AbortSignal,
): Promise<S3BucketVersioning> {
  const result = await callServiceOperation<{ Status?: string; MFADelete?: string }>(
    SERVICE_ID,
    'GetBucketVersioning',
    { Bucket: bucket },
    signal,
  );
  const status =
    result.Status === 'Enabled' || result.Status === 'Suspended' ? result.Status : 'Unversioned';
  return { status, mfaDelete: result.MFADelete === 'Enabled' };
}

export async function putBucketVersioning(input: {
  bucket: string;
  enabled: boolean;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'PutBucketVersioning', {
    Bucket: input.bucket,
    VersioningConfiguration: { Status: input.enabled ? 'Enabled' : 'Suspended' },
  });
}

// ------------------------------------------------------------------- tags

/** `GetBucketTagging`; an untagged bucket answers with an empty tag set. */
export async function getBucketTags(
  bucket: string,
  signal?: AbortSignal,
): Promise<readonly AwsTag[]> {
  try {
    const result = await callServiceOperation<{ TagSet?: AwsTag[] }>(
      SERVICE_ID,
      'GetBucketTagging',
      { Bucket: bucket },
      signal,
    );
    return result.TagSet ?? [];
  } catch (error) {
    if (isS3Code(error, 'NoSuchTagSet', 'NoSuchTagSetError')) return [];
    throw error;
  }
}

/** `PutBucketTagging` replaces the entire tag set. */
export async function putBucketTags(input: {
  bucket: string;
  tags: readonly AwsTag[];
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'PutBucketTagging', {
    Bucket: input.bucket,
    Tagging: { TagSet: [...input.tags] },
  });
}

export async function deleteBucketTags(bucket: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteBucketTagging', { Bucket: bucket });
}

// ----------------------------------------------------------------- policy

/** `GetBucketPolicy`; a bucket without a policy answers `undefined`. */
export async function getBucketPolicy(
  bucket: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const result = await callServiceOperation<{ Policy?: string }>(
      SERVICE_ID,
      'GetBucketPolicy',
      { Bucket: bucket },
      signal,
    );
    return result.Policy;
  } catch (error) {
    if (isS3Code(error, 'NoSuchBucketPolicy', 'NoSuchBucketPolicyError')) return undefined;
    throw error;
  }
}

export async function putBucketPolicy(input: { bucket: string; policy: string }): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'PutBucketPolicy', {
    Bucket: input.bucket,
    Policy: input.policy,
  });
}

export async function deleteBucketPolicy(bucket: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteBucketPolicy', { Bucket: bucket });
}

// ------------------------------------------------------------ permissions

/** The four Block Public Access settings plus whether the bucket has them. */
export interface S3PublicAccessState extends S3PublicAccessBlock {
  /** False when the bucket has no configuration (the API's "not found"). */
  configured: boolean;
}

const NO_PUBLIC_ACCESS: Omit<S3PublicAccessState, 'configured'> = {
  BlockPublicAcls: false,
  IgnorePublicAcls: false,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false,
};

export async function getPublicAccessBlock(
  bucket: string,
  signal?: AbortSignal,
): Promise<S3PublicAccessState> {
  try {
    const result = await callServiceOperation<{
      PublicAccessBlockConfiguration?: Partial<S3PublicAccessBlock>;
    }>(SERVICE_ID, 'GetPublicAccessBlock', { Bucket: bucket }, signal);
    const configuration = result.PublicAccessBlockConfiguration;
    if (configuration === undefined) {
      return { ...NO_PUBLIC_ACCESS, configured: false };
    }
    return {
      BlockPublicAcls: configuration.BlockPublicAcls === true,
      IgnorePublicAcls: configuration.IgnorePublicAcls === true,
      BlockPublicPolicy: configuration.BlockPublicPolicy === true,
      RestrictPublicBuckets: configuration.RestrictPublicBuckets === true,
      configured: true,
    };
  } catch (error) {
    if (isS3Code(error, 'NoSuchPublicAccessBlockConfiguration')) {
      return { ...NO_PUBLIC_ACCESS, configured: false };
    }
    throw error;
  }
}

export async function putPublicAccessBlock(input: {
  bucket: string;
  settings: S3PublicAccessBlock;
}): Promise<void> {
  // Pick the four settings explicitly: callers may hand in a wider state object
  // (the loaded configuration carries a `configured` flag) and the request
  // must contain only what the API accepts.
  await callServiceOperation(SERVICE_ID, 'PutPublicAccessBlock', {
    Bucket: input.bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: input.settings.BlockPublicAcls,
      IgnorePublicAcls: input.settings.IgnorePublicAcls,
      BlockPublicPolicy: input.settings.BlockPublicPolicy,
      RestrictPublicBuckets: input.settings.RestrictPublicBuckets,
    },
  });
}

/** `DeletePublicAccessBlock` — removes the bucket's explicit configuration. */
export async function deletePublicAccessBlock(bucket: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeletePublicAccessBlock', { Bucket: bucket });
}

// ------------------------------------------------------------- encryption

export interface S3BucketEncryption {
  configured: boolean;
  /** e.g. `AES256` or `aws:kms`. */
  algorithm?: string;
  kmsKeyArn?: string;
  /** SSE-KMS bucket key setting, when the bucket uses a KMS key. */
  bucketKeyEnabled?: boolean;
}

export async function getBucketEncryption(
  bucket: string,
  signal?: AbortSignal,
): Promise<S3BucketEncryption> {
  try {
    const result = await callServiceOperation<{
      ServerSideEncryptionConfiguration?: {
        Rules?: {
          ApplyServerSideEncryptionByDefault?: {
            SSEAlgorithm?: string;
            KMSMasterKeyID?: string;
          };
          BucketKeyEnabled?: boolean;
        }[];
      };
    }>(SERVICE_ID, 'GetBucketEncryption', { Bucket: bucket }, signal);

    const rule = result.ServerSideEncryptionConfiguration?.Rules?.[0];
    // An empty Rules array means "no explicit rule": S3 applies SSE-S3, which
    // the console renders as the default rather than an unknown algorithm.
    if (rule === undefined) return { configured: false };
    const defaults = rule.ApplyServerSideEncryptionByDefault;
    return {
      configured: true,
      ...(defaults?.SSEAlgorithm === undefined ? {} : { algorithm: defaults.SSEAlgorithm }),
      ...(defaults?.KMSMasterKeyID === undefined ? {} : { kmsKeyArn: defaults.KMSMasterKeyID }),
      ...(rule.BucketKeyEnabled === undefined ? {} : { bucketKeyEnabled: rule.BucketKeyEnabled }),
    };
  } catch (error) {
    if (
      isS3Code(error, 'ServerSideEncryptionConfigurationNotFoundError', 'NoSuchBucketEncryption')
    ) {
      return { configured: false };
    }
    throw error;
  }
}
