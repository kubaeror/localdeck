/**
 * S3 DTOs shared by the api's object-proxy routes and the ui.
 *
 * Most S3 operations go through the generic dispatcher
 * (`POST /api/services/s3/:operation`), whose JSON contract cannot carry object
 * bytes. Uploads and downloads therefore have two dedicated proxy routes, and
 * their paths, request shapes and response shapes live here so both apps agree
 * on a single definition.
 */

/** Paths of the dedicated S3 object proxy routes. */
export const S3_PROXY_PATHS = {
  /**
   * `POST` a single `multipart/form-data` file part named `file`, with
   * `bucket` and `key` as query parameters. The api chooses PutObject or the S3
   * multipart upload API based on the size of the stream it receives.
   */
  upload: '/api/services/s3/objects/upload',
  /**
   * `GET` with `bucket` and `key` (and an optional `versionId`) as query
   * parameters. The api presigns a GetObject URL against the LocalStack
   * endpoint and streams the object through itself, so the browser never talks
   * to LocalStack and no credentials or signatures reach the page.
   */
  download: '/api/services/s3/objects/download',
} as const;

export type S3ProxyPath = (typeof S3_PROXY_PATHS)[keyof typeof S3_PROXY_PATHS];

/** Builds an `?a=1&b=2` query string, skipping unset values. */
function toQueryString(params: Readonly<Record<string, string | undefined>>): string {
  const encoded = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1].length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return encoded.length === 0 ? '' : `?${encoded}`;
}

/** One object to download through the proxy. */
export interface S3DownloadRequest {
  bucket: string;
  key: string;
  /** Loads a specific object version when the bucket has versioning on. */
  versionId?: string;
}

/** Downloads are plain links, so the request is encoded into the query string. */
export function s3DownloadPath(input: S3DownloadRequest): string {
  return `${S3_PROXY_PATHS.download}${toQueryString({
    bucket: input.bucket,
    key: input.key,
    versionId: input.versionId,
  })}`;
}

/** Upload target for one file; the bytes travel in the request body. */
export function s3UploadPath(input: { bucket: string; key: string }): string {
  return `${S3_PROXY_PATHS.upload}${toQueryString({ bucket: input.bucket, key: input.key })}`;
}

/** One object written by the upload proxy. */
export interface S3UploadResult {
  bucket: string;
  key: string;
  /** Bytes stored. */
  size: number;
  /** True when the api used the S3 multipart upload API (large objects). */
  multipart: boolean;
  etag?: string;
  versionId?: string;
}

/** Response body of `POST /api/services/s3/objects/upload`. */
export interface S3UploadResponse {
  upload: S3UploadResult;
}

/**
 * The four Block Public Access settings, in the spelling the SDK uses. The
 * console edits them as one master toggle; `S3_PUBLIC_ACCESS_DEFAULTS` is the
 * state the AWS console applies when the master toggle is turned off.
 */
export interface S3PublicAccessBlock {
  BlockPublicAcls: boolean;
  IgnorePublicAcls: boolean;
  BlockPublicPolicy: boolean;
  RestrictPublicBuckets: boolean;
}

/** Every setting on: what the console stores when the toggle is enabled. */
export const S3_PUBLIC_ACCESS_ALL_BLOCKED: S3PublicAccessBlock = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};

/**
 * The console's defaults when the master toggle is turned off: new public ACLs
 * and public policy changes stay blocked, while public bucket policies and
 * cross-account access become possible.
 */
export const S3_PUBLIC_ACCESS_DEFAULTS: S3PublicAccessBlock = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false,
};
