import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ApiErrorCodes,
  S3_PROXY_PATHS,
  type S3UploadResponse,
  type S3UploadResult,
} from '@localdeck/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { getS3ClientFor, type AwsClientConfigOverrides } from '../lib/awsClients.js';
import { ApiProblem } from '../lib/errors.js';

/**
 * Dedicated S3 object proxy routes.
 *
 * The generic dispatcher speaks JSON, so object bytes cannot travel through it.
 * These two routes are the only S3-specific endpoints LocalDeck adds:
 *
 * - `POST /api/services/s3/objects/upload?bucket&key` accepts one
 *   `multipart/form-data` file part and writes it with PutObject, switching to
 *   the S3 multipart upload API for files above `MULTIPART_THRESHOLD_BYTES`.
 * - `GET /api/services/s3/objects/download?bucket&key[&versionId]` presigns a
 *   GetObject URL against the configured LocalStack endpoint and streams the
 *   response through the api ("presigned-URL proxy"): the browser receives the
 *   bytes from the same origin it talks to for everything else, and no
 *   credentials or signatures reach the page.
 *
 * Both use the single client factory in `lib/awsClients.ts`, so they inherit
 * path-style addressing, endpoint, region and credentials from one place.
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

const BUCKET_NAME_PATTERN = '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$';

const uploadQuerystringSchema = {
  type: 'object',
  required: ['bucket', 'key'],
  additionalProperties: false,
  properties: {
    bucket: { type: 'string', minLength: 3, maxLength: 63, pattern: BUCKET_NAME_PATTERN },
    key: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

const downloadQuerystringSchema = {
  type: 'object',
  required: ['bucket', 'key'],
  additionalProperties: false,
  properties: {
    bucket: { type: 'string', minLength: 3, maxLength: 63, pattern: BUCKET_NAME_PATTERN },
    key: { type: 'string', minLength: 1, maxLength: 1024 },
    versionId: { type: 'string', minLength: 1, maxLength: 1024 },
  },
} as const;

/** Pulls `count` bytes off the front of a chunk list, mutating the list. */
function takeBytes(chunks: Buffer[], count: number): Buffer {
  const out = Buffer.allocUnsafe(count);
  let offset = 0;
  while (offset < count) {
    const head = chunks[0];
    if (head === undefined) throw new Error('part buffer underflow');
    const used = Math.min(head.length, count - offset);
    head.copy(out, offset, 0, used);
    offset += used;
    if (used === head.length) chunks.shift();
    else chunks[0] = head.subarray(used);
  }
  return out;
}

/**
 * Streams one uploaded file into S3. Small files become a single PutObject;
 * once the stream crosses `MULTIPART_THRESHOLD_BYTES` the object is created
 * with CreateMultipartUpload and uploaded as 8 MiB parts, then completed. A
 * failure aborts the multipart upload so no orphaned parts remain.
 */
async function uploadStream(
  client: S3Client,
  input: { bucket: string; key: string; contentType?: string; stream: Readable },
): Promise<S3UploadResult> {
  const { bucket, key, contentType, stream } = input;
  const chunks: Buffer[] = [];
  const completed: CompletedPart[] = [];
  let buffered = 0;
  let size = 0;
  let uploadId: string | undefined;
  let partNumber = 1;

  const createMultipartUpload = async (): Promise<string> => {
    const created = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ...(contentType === undefined ? {} : { ContentType: contentType }),
      }),
    );
    if (created.UploadId === undefined) {
      throw new ApiProblem({
        code: ApiErrorCodes.badGateway,
        statusCode: 502,
        message: 'LocalStack accepted CreateMultipartUpload but returned no UploadId.',
        service: 's3',
        details: { bucket, key },
      });
    }
    return created.UploadId;
  };

  const flushFullParts = async (id: string): Promise<void> => {
    while (buffered >= PART_SIZE_BYTES) {
      const body = takeBytes(chunks, PART_SIZE_BYTES);
      buffered -= PART_SIZE_BYTES;
      const response = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: id,
          PartNumber: partNumber,
          Body: body,
        }),
      );
      completed.push({ ETag: response.ETag, PartNumber: partNumber });
      partNumber += 1;
    }
  };

  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
      if (chunk.length === 0) continue;
      chunks.push(chunk);
      buffered += chunk.length;
      size += chunk.length;

      if (uploadId === undefined && size > MULTIPART_THRESHOLD_BYTES) {
        uploadId = await createMultipartUpload();
      }
      if (uploadId !== undefined) await flushFullParts(uploadId);
    }

    if (uploadId === undefined) {
      // Below the threshold: one PutObject with everything that was read.
      const response = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: Buffer.concat(chunks),
          ...(contentType === undefined ? {} : { ContentType: contentType }),
        }),
      );
      return {
        bucket,
        key,
        size,
        multipart: false,
        ...(response.ETag === undefined ? {} : { etag: response.ETag }),
        ...(response.VersionId === undefined ? {} : { versionId: response.VersionId }),
      };
    }

    // The last part may be smaller than PART_SIZE_BYTES, but never empty.
    if (buffered > 0) {
      const body = takeBytes(chunks, buffered);
      buffered = 0;
      const response = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }),
      );
      completed.push({ ETag: response.ETag, PartNumber: partNumber });
    }

    const done = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: completed },
      }),
    );
    return {
      bucket,
      key,
      size,
      multipart: true,
      ...(done.ETag === undefined ? {} : { etag: done.ETag }),
      ...(done.VersionId === undefined ? {} : { versionId: done.VersionId }),
    };
  } catch (error) {
    if (uploadId !== undefined) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
        );
      } catch {
        // The original failure is the one worth reporting.
      }
    }
    throw error;
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

/** Streams one presigned LocalStack response to the LocalDeck client. */
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
  const upstream = await fetch(presignedUrl, { headers: { accept: '*/*' } });

  if (!upstream.ok) {
    const body = await upstream.text();
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
 * endpoint/region the running app was configured with, so the proxy talks to
 * the same LocalStack as `/api/health`.
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
        throw new ApiProblem({
          code: ApiErrorCodes.validationFailed,
          statusCode: 400,
          message: `Expected the file part to be named "file", received "${part.fieldname}".`,
          service: 's3',
          details: { bucket, key, fieldname: part.fieldname },
        });
      }

      const upload = await uploadStream(getS3ClientFor(clientOverrides), {
        bucket,
        key,
        ...(part.mimetype.length === 0 ? {} : { contentType: part.mimetype }),
        stream: part.file,
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
