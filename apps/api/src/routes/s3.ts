import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  ApiErrorCodes,
  S3_BUCKET_NAME_MAX_LENGTH,
  S3_BUCKET_NAME_MIN_LENGTH,
  S3_BUCKET_NAME_PATTERN,
  S3_KEY_MAX_LENGTH,
  S3_PROXY_PATHS,
  isS3KeyWithinLimit,
  utf8ByteLength,
  type S3UploadResponse,
  type S3UploadResult,
} from '@localdeck/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable, Transform } from 'node:stream';
import {
  getS3ClientFor,
  sdkAbortSignal,
  type AwsClientConfigOverrides,
} from '../lib/awsClients.js';
import { ApiProblem, asApiProblem } from '../lib/errors.js';
import { clientDisconnectSignal } from '../lib/http.js';

/**
 * Dedicated S3 object proxy routes.
 *
 * The generic dispatcher speaks JSON, so object bytes cannot travel through it.
 * These two routes are the only S3-specific endpoints LocalDeck adds:
 *
 * - `POST /api/services/s3/objects/upload?bucket&key` accepts one
 *   `multipart/form-data` file part and writes it with PutObject, switching to
 *   the S3 multipart upload API for files above `MULTIPART_THRESHOLD_BYTES`
 *   through `@aws-sdk/lib-storage` (bounded-concurrency parts, automatic abort
 *   on failure). A part truncated by the request size limit aborts the upload
 *   with a clean 413 instead of storing a silently truncated object.
 * - `GET /api/services/s3/objects/download?bucket&key[&versionId]` streams the
 *   object straight from the SDK through the api: bytes, content-encoding and
 *   content-length are the stored ones (no transparent decompression), and the
 *   SDK does not rewrite dot-segments in the key.
 *
 * Both use the single client factory in `lib/awsClients.ts`, so they inherit
 * path-style addressing, endpoint, region, credentials and outbound timeouts
 * from one place.
 */

/** Files above this size use the S3 multipart upload API. */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
/** Size of each UploadPart once multipart upload is in use (S3 minimum: 5 MiB). */
const PART_SIZE_BYTES = 8 * 1024 * 1024;
/** S3's single-object maximum; @fastify/multipart truncates the part here. */
const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
/**
 * Streaming routes must not inherit the 31 s JSON handler timeout: a 5 GiB
 * upload or a slow download legitimately outlives it. Six hours is a hard
 * ceiling; the SDK request timeout and client disconnect govern the rest.
 */
const STREAMING_HANDLER_TIMEOUT_MS = 6 * 60 * 60 * 1000;

interface UploadQuery {
  bucket: string;
  key: string;
}

interface DownloadQuery {
  bucket: string;
  key: string;
  versionId?: string;
}

const uploadQuerystringSchema = {
  type: 'object',
  required: ['bucket', 'key'],
  additionalProperties: false,
  properties: {
    bucket: {
      type: 'string',
      minLength: S3_BUCKET_NAME_MIN_LENGTH,
      maxLength: S3_BUCKET_NAME_MAX_LENGTH,
      pattern: S3_BUCKET_NAME_PATTERN,
    },
    key: { type: 'string', minLength: 1, maxLength: S3_KEY_MAX_LENGTH },
  },
} as const;

const downloadQuerystringSchema = {
  type: 'object',
  required: ['bucket', 'key'],
  additionalProperties: false,
  properties: {
    bucket: {
      type: 'string',
      minLength: S3_BUCKET_NAME_MIN_LENGTH,
      maxLength: S3_BUCKET_NAME_MAX_LENGTH,
      pattern: S3_BUCKET_NAME_PATTERN,
    },
    key: { type: 'string', minLength: 1, maxLength: S3_KEY_MAX_LENGTH },
    versionId: { type: 'string', minLength: 1, maxLength: S3_KEY_MAX_LENGTH },
  },
} as const;

/**
 * S3's key limit is 1024 UTF-8 bytes; JSON-schema `maxLength` counts UTF-16
 * code units, so multi-byte keys need this explicit check (shared with the ui).
 *
 * Dot segments are refused: a key like `../other-bucket/secret` would be
 * normalized away by any URL-based hop (the previous presigned-URL download
 * could read outside the requested bucket on emulators that do not verify
 * signatures), and `a/./b` silently addresses a different object.
 */
function requireValidKey(key: string): void {
  if (!isS3KeyWithinLimit(key)) {
    throw new ApiProblem({
      code: ApiErrorCodes.validationFailed,
      statusCode: 400,
      message:
        `Object keys are limited to 1024 UTF-8 bytes; "${key.slice(0, 64)}" uses ` +
        `${utf8ByteLength(key)} bytes.`,
      service: 's3',
      details: { maxBytes: 1024, actualBytes: utf8ByteLength(key) },
    });
  }
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new ApiProblem({
      code: ApiErrorCodes.validationFailed,
      statusCode: 400,
      message:
        'Object keys must not contain "." or ".." path segments; URL normalization would ' +
        'silently address a different object or escape the bucket.',
      service: 's3',
      details: { key: key.slice(0, 200) },
    });
  }
}

/**
 * Throws a clean 400 for a rejected upload part. The part's stream is resumed
 * first: a paused multipart part keeps the request socket open and desyncs
 * keep-alive connections when the handler throws without draining it (API-007).
 */
export function rejectUploadPart(
  part: { file: Readable; fieldname: string },
  query: UploadQuery,
): never {
  part.file.resume();
  throw new ApiProblem({
    code: ApiErrorCodes.validationFailed,
    statusCode: 400,
    message: `Expected the file part to be named "file", received "${part.fieldname}".`,
    service: 's3',
    details: { bucket: query.bucket, key: query.key, fieldname: part.fieldname },
  });
}

/** Raised when @fastify/multipart truncated the part at the size limit. */
class UploadTruncatedError extends Error {
  constructor() {
    super(`The upload exceeded the ${MAX_OBJECT_BYTES} byte single-object limit.`);
    this.name = 'UploadTruncatedError';
  }
}

/**
 * Passes bytes through and fails the upload when busboy truncated the source
 * stream. Without this, lib-storage completes a PutObject with the truncated
 * bytes and reports success. Exported for the truncation unit test.
 */
export function truncationGuard(source: Readable): Transform {
  const truncated = (): boolean => (source as { truncated?: boolean }).truncated === true;
  return new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      callback(truncated() ? new UploadTruncatedError() : null);
    },
  });
}

/**
 * Streams one uploaded file into S3 through `@aws-sdk/lib-storage`: small
 * files become a single PutObject, larger ones a concurrent multipart upload.
 * A failure aborts the multipart upload (lib-storage default) so no orphaned
 * parts remain, and a client disconnect aborts the upload through
 * `request.signal`.
 */
async function uploadStream(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    contentType?: string;
    stream: Readable;
    signal: AbortSignal;
  },
): Promise<S3UploadResult> {
  const { bucket, key, contentType, stream, signal } = input;

  let size = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += buffer.length;
      callback(null, buffer);
    },
  });

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: stream.pipe(truncationGuard(stream)).pipe(counter),
      ...(contentType === undefined ? {} : { ContentType: contentType }),
    },
    partSize: PART_SIZE_BYTES,
    queueSize: 4,
    leavePartsOnError: false,
  });

  const abortOnDisconnect = (): void => {
    void upload.abort();
  };
  signal.addEventListener('abort', abortOnDisconnect, { once: true });
  // `addEventListener` does not fire for a signal that is already aborted.
  if (signal.aborted) void upload.abort();

  try {
    const done = await upload.done();
    return {
      bucket,
      key,
      size,
      // lib-storage falls back to PutObject when the body never exceeds one part.
      multipart: size > MULTIPART_THRESHOLD_BYTES,
      ...(done.ETag === undefined ? {} : { etag: done.ETag }),
      ...(done.VersionId === undefined ? {} : { versionId: done.VersionId }),
    };
  } catch (error) {
    if (
      error instanceof UploadTruncatedError ||
      (stream as { truncated?: boolean }).truncated === true
    ) {
      throw new ApiProblem({
        code: ApiErrorCodes.payloadTooLarge,
        statusCode: 413,
        message: `The upload exceeded the ${MAX_OBJECT_BYTES} byte single-object limit and was not stored.`,
        service: 's3',
        details: { bucket, key, limitBytes: MAX_OBJECT_BYTES, bytesReceived: size },
        cause: error,
      });
    }
    if (signal.aborted) {
      throw new ApiProblem({
        code: ApiErrorCodes.requestAborted,
        statusCode: 408,
        message: 'The upload was aborted before it completed.',
        service: 's3',
        details: { bucket, key, bytesUploaded: size },
        cause: error,
      });
    }
    throw error;
  } finally {
    signal.removeEventListener('abort', abortOnDisconnect);
  }
}

/** `Content-Disposition` for the downloaded object's file name. */
function contentDispositionFor(key: string): string {
  const name =
    key
      .split('/')
      .filter((segment) => segment.length > 0)
      .pop() ?? key;
  if (/^[\x20-\x7e]+$/.test(name)) {
    return `attachment; filename="${name.replace(/["\\]/g, '_')}"`;
  }
  return `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Streams one object through the api with GetObjectCommand. Using the SDK
 * instead of fetching a presigned URL keeps the stored bytes intact: no
 * transparent decompression, no URL dot-segment rewriting, and content-length
 * matches the body exactly.
 */
async function streamObjectDownload(
  client: S3Client,
  query: DownloadQuery,
  endpoint: string | undefined,
  range: string | undefined,
  reply: FastifyReply,
): Promise<void> {
  const command = new GetObjectCommand({
    Bucket: query.bucket,
    Key: query.key,
    ...(query.versionId === undefined ? {} : { VersionId: query.versionId }),
    ...(range === undefined ? {} : { Range: range }),
  });

  let output: GetObjectCommandOutput;
  try {
    output = await client.send(command, {
      abortSignal: sdkAbortSignal(clientDisconnectSignal(reply)),
    });
  } catch (error) {
    throw asApiProblem(error, {
      ...(endpoint === undefined ? {} : { endpoint }),
      service: 's3',
    });
  }

  const body = output.Body;
  if (body === undefined || body === null || !(body instanceof Readable)) {
    throw new ApiProblem({
      code: ApiErrorCodes.badGateway,
      statusCode: 502,
      message: 'The object download returned no streamable body.',
      service: 's3',
      details: { bucket: query.bucket, key: query.key },
    });
  }

  const headers: [string, string][] = [];
  if (output.ContentType !== undefined) headers.push(['content-type', output.ContentType]);
  if (output.ContentLength !== undefined)
    headers.push(['content-length', String(output.ContentLength)]);
  if (output.ContentEncoding !== undefined)
    headers.push(['content-encoding', output.ContentEncoding]);
  if (output.ETag !== undefined) headers.push(['etag', output.ETag]);
  if (output.LastModified !== undefined)
    headers.push(['last-modified', output.LastModified.toUTCString()]);
  if (output.AcceptRanges !== undefined) headers.push(['accept-ranges', output.AcceptRanges]);
  if (output.ContentRange !== undefined) headers.push(['content-range', output.ContentRange]);
  for (const [name, value] of headers) void reply.header(name, value);
  void reply.header('content-disposition', contentDispositionFor(query.key));
  // Provenance for the console and the live verification script.
  void reply.header('x-localdeck-download-mode', 'sdk-stream');
  if (output.ContentRange !== undefined) void reply.code(206);

  await reply.send(body);
}

/**
 * Registers the S3 object proxy routes. `clientOverrides` carries the
 * endpoint/region/timeouts the running app was configured with, so the proxy
 * talks to the same emulator as `/api/health`.
 */
export function registerS3Routes(
  app: FastifyInstance,
  clientOverrides: AwsClientConfigOverrides = {},
): void {
  app.post<{ Querystring: UploadQuery }>(
    S3_PROXY_PATHS.upload,
    {
      schema: { querystring: uploadQuerystringSchema },
      handlerTimeout: STREAMING_HANDLER_TIMEOUT_MS,
    },
    async (request, reply): Promise<S3UploadResponse> => {
      const { bucket, key } = request.query;
      requireValidKey(key);

      const part = await request.file();
      if (part === undefined) {
        throw new ApiProblem({
          code: ApiErrorCodes.validationFailed,
          statusCode: 400,
          message:
            'Uploads must be multipart/form-data with a single file part named "file". ' +
            'Send the target as query parameters: ?bucket=<bucket>&key=<key>.',
          service: 's3',
          details: { bucket, key },
        });
      }
      if (part.fieldname !== 'file') {
        rejectUploadPart(part, { bucket, key });
      }

      const client = getS3ClientFor(clientOverrides);
      const upload = await uploadStream(client, {
        bucket,
        key,
        ...(part.mimetype.length === 0 ? {} : { contentType: part.mimetype }),
        stream: part.file,
        signal: clientDisconnectSignal(reply),
      });

      // A part truncated by busboy is rejected inside uploadStream, which
      // aborts before storing anything; this is the belt-and-braces check for
      // the case where the stream ended after the guard ran.
      if ((part.file as { truncated?: boolean }).truncated === true) {
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: AbortSignal.timeout(10_000),
          })
          .catch(() => undefined);
        throw new ApiProblem({
          code: ApiErrorCodes.payloadTooLarge,
          statusCode: 413,
          message: `The upload exceeded the ${MAX_OBJECT_BYTES} byte single-object limit and was not stored.`,
          service: 's3',
          details: { bucket, key, limitBytes: MAX_OBJECT_BYTES },
        });
      }

      request.log.info(
        { bucket, key, size: upload.size, multipart: upload.multipart },
        's3 object uploaded through the LocalDeck proxy',
      );
      void reply.code(201);
      return { upload };
    },
  );

  app.get<{ Querystring: DownloadQuery }>(
    S3_PROXY_PATHS.download,
    {
      schema: { querystring: downloadQuerystringSchema },
      handlerTimeout: STREAMING_HANDLER_TIMEOUT_MS,
    },
    async (request, reply): Promise<void> => {
      const { bucket, key, versionId } = request.query;
      requireValidKey(key);
      request.log.info(
        { bucket, key, mode: 'sdk-stream' },
        's3 object downloaded through the LocalDeck proxy',
      );
      const query: DownloadQuery = {
        bucket,
        key,
        ...(versionId === undefined ? {} : { versionId }),
      };
      const rangeHeader = request.headers.range;
      await streamObjectDownload(
        getS3ClientFor(clientOverrides),
        query,
        clientOverrides.endpoint,
        typeof rangeHeader === 'string' && rangeHeader.length > 0 ? rangeHeader : undefined,
        reply,
      );
    },
  );
}
