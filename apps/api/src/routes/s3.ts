import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
import { ApiProblem } from '../lib/errors.js';
import { clientDisconnectSignal, readCappedText } from '../lib/http.js';

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
 *   on failure).
 * - `GET /api/services/s3/objects/download?bucket&key[&versionId]` presigns a
 *   GetObject URL against the configured LocalStack endpoint and streams the
 *   response through the api ("presigned-URL proxy"): the browser receives the
 *   bytes from the same origin it talks to for everything else, and no
 *   credentials or signatures reach the page.
 *
 * Both use the single client factory in `lib/awsClients.ts`, so they inherit
 * path-style addressing, endpoint, region, credentials and outbound timeouts
 * from one place.
 */

/** Files above this size use the S3 multipart upload API. */
const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
/** Size of each UploadPart once multipart upload is in use (S3 minimum: 5 MiB). */
const PART_SIZE_BYTES = 8 * 1024 * 1024;
/** How long the presigned download URL stays valid. */
const PRESIGN_TTL_SECONDS = 300;

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
      Body: stream.pipe(counter),
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

/** Minimal S3 XML error document reader for presigned-URL failures. */
function parseS3ErrorXml(body: string): { code?: string; message?: string } {
  const code = /<Code>([^<]*)<\/Code>/i.exec(body)?.[1]?.trim();
  const message = /<Message>([^<]*)<\/Message>/i.exec(body)?.[1]?.trim();
  return {
    ...(code === undefined || code.length === 0 ? {} : { code }),
    ...(message === undefined || message.length === 0 ? {} : { message }),
  };
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
 * Streams one presigned LocalStack response to the LocalDeck client. Error
 * bodies are read with a 64 KiB cap (API-008); success bodies stream through.
 */
async function proxyPresignedDownload(
  client: S3Client,
  query: DownloadQuery,
  reply: FastifyReply,
): Promise<void> {
  const command = new GetObjectCommand({
    Bucket: query.bucket,
    Key: query.key,
    ...(query.versionId === undefined ? {} : { VersionId: query.versionId }),
  });
  const presignedUrl = await getSignedUrl(client, command, { expiresIn: PRESIGN_TTL_SECONDS });
  const upstream = await fetch(presignedUrl, {
    headers: { accept: '*/*' },
    // A browser that goes away cancels the upstream fetch instead of holding
    // the socket open; the request timeout is applied by the SDK helper.
    signal: sdkAbortSignal(clientDisconnectSignal(reply)),
  });

  if (!upstream.ok) {
    const body = await readCappedText(upstream);
    const parsed = parseS3ErrorXml(body);
    const statusCode = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
    throw new ApiProblem({
      code: parsed.code ?? ApiErrorCodes.badGateway,
      statusCode,
      message:
        parsed.message ??
        `LocalStack returned HTTP ${upstream.status} for the presigned download of ` +
          `${query.bucket}/${query.key}.`,
      service: 's3',
      details: {
        bucket: query.bucket,
        key: query.key,
        upstreamStatusCode: upstream.status,
        mode: 'presigned-proxy',
      },
    });
  }

  if (upstream.body === null) {
    throw new ApiProblem({
      code: ApiErrorCodes.badGateway,
      statusCode: 502,
      message: 'The presigned download returned no body.',
      service: 's3',
      details: { bucket: query.bucket, key: query.key },
    });
  }

  const passThrough = ['content-type', 'content-length', 'etag', 'last-modified', 'accept-ranges'];
  for (const header of passThrough) {
    const value = upstream.headers.get(header);
    if (value !== null) void reply.header(header, value);
  }
  void reply.header('content-disposition', contentDispositionFor(query.key));
  // Provenance for the console and the live verification script.
  void reply.header('x-localdeck-download-mode', 'presigned-proxy');
  void reply.header('x-localdeck-presigned-expires', String(PRESIGN_TTL_SECONDS));

  await reply.send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
}

/**
 * Registers the S3 object proxy routes. `clientOverrides` carries the
 * endpoint/region/timeouts the running app was configured with, so the proxy
 * talks to the same LocalStack as `/api/health`.
 */
export function registerS3Routes(
  app: FastifyInstance,
  clientOverrides: AwsClientConfigOverrides = {},
): void {
  app.post<{ Querystring: UploadQuery }>(
    S3_PROXY_PATHS.upload,
    { schema: { querystring: uploadQuerystringSchema } },
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

      const upload = await uploadStream(getS3ClientFor(clientOverrides), {
        bucket,
        key,
        ...(part.mimetype.length === 0 ? {} : { contentType: part.mimetype }),
        stream: part.file,
        signal: clientDisconnectSignal(reply),
      });

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
    { schema: { querystring: downloadQuerystringSchema } },
    async (request, reply): Promise<void> => {
      const { bucket, key, versionId } = request.query;
      requireValidKey(key);
      request.log.info(
        { bucket, key, mode: 'presigned-proxy' },
        's3 object downloaded through the LocalDeck proxy',
      );
      const query: DownloadQuery = {
        bucket,
        key,
        ...(versionId === undefined ? {} : { versionId }),
      };
      await proxyPresignedDownload(getS3ClientFor(clientOverrides), query, reply);
    },
  );
}
