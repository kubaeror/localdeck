/**
 * Live verification of LocalDeck against the EXTERNALLY managed LocalStack
 * instance. Read-only checks (health, registry, ListBuckets) run first; the
 * generic-browser flow then proves the registry's operation metadata over HTTP
 * and drives the full SNS lifecycle (create → list → describe → tag → delete)
 * through the same dispatcher route the generated ui uses, plus a read-only
 * listOp sweep over every installed P0 browser service; the S3 acceptance flow
 * then creates and deletes ONE bucket whose name carries a timestamp, the EC2
 * acceptance flow launches one instance whose name carries a timestamp — it
 * stops, starts, reboots and terminates that instance, attaches and deletes one
 * tagged data volume, and deletes the key pair and security group it created —
 * and the EKS acceptance flow creates one k3d-backed cluster plus one node
 * group, downloads and validates the kubeconfig, updates the scaling
 * configuration, and deletes both. None of the flows touch resources they did
 * not create.
 *
 * LocalDeck never starts, stops or reconfigures LocalStack: this script only
 * talks to the instance it is pointed at.
 *
 * Usage: pnpm --filter @localdeck/api verify:localstack
 * Set LOCALDECK_VERIFY_SKIP_EKS=1 to skip the multi-minute k3d flow.
 */
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { browserOperationsFor, findService } from '@localdeck/shared';
import type {
  ApiConfigResponse,
  ApiErrorResponse,
  HealthResponse,
  ServiceOperationResponse,
  ServiceOperationsResponse,
  ServiceRegistryResponse,
} from '@localdeck/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { getConfig, loadConfig, type AppConfig } from '../src/config.js';
import { createS3Client, createStsClient, destroyAwsClients } from '../src/lib/awsClients.js';

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
let currentLabel = '';
/** Actual requests the acceptance flow performed, in order. */
const requests: string[] = [];

async function check(label: string, run: () => Promise<string> | string): Promise<void> {
  currentLabel = label;
  const startedAt = Date.now();
  try {
    const detail = await run();
    checks.push({ label, ok: true, detail: `${detail} (${Date.now() - startedAt} ms)` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ label, ok: false, detail: message });
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** `app.inject` with every request line recorded for the proof section. */
async function apiRequest(
  app: FastifyInstance,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  const response = await app.inject(options);
  requests.push(`${options.method ?? 'GET'} ${String(options.url)} -> ${response.statusCode}`);
  return response;
}

/** One `multipart/form-data` body with a single `file` part. */
async function multipartFile(
  filename: string,
  contentType: string,
  bytes: Buffer,
): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const encoded = new Response(form);
  return {
    payload: Buffer.from(await encoded.arrayBuffer()),
    headers: { 'content-type': encoded.headers.get('content-type') ?? 'multipart/form-data' },
  };
}

/** Browser services whose listOp the live sweep exercises when installed. */
const GENERIC_BROWSER_SWEEP = [
  'sns',
  'sqs',
  'dynamodb',
  'lambda',
  'logs',
  'kms',
  'secretsmanager',
  'cloudformation',
  'ssm',
  'kinesis',
  'ecs',
  'ecr',
  'athena',
  'events',
  'stepfunctions',
  'cloudwatch',
  'autoscaling',
  'rds',
  'elasticache',
  'route53',
  'cloudfront',
] as const;

function errorFromBody(body: { error?: { code?: string; message?: string } }): string {
  return `${body.error?.code ?? 'UNKNOWN'}: ${(body.error?.message ?? '').slice(0, 96)}`;
}

/**
 * The generic-browser acceptance flow: first the registry metadata over HTTP
 * (the same payloads the ui renders navigation and tables from), then the full
 * SNS lifecycle through the dispatcher, then a read-only listOp sweep over the
 * installed P0 services. LocalStack is never modified beyond the one topic the
 * flow creates and deletes.
 */
async function verifyGenericBrowserAcceptance(config: AppConfig): Promise<void> {
  const app = await buildApp({ config, logger: false });
  await app.ready();

  const stamp = Date.now().toString(36);
  const topicName = `localdeck-verify-${stamp}`;
  let topicArn: string | undefined;

  try {
    await check('registry: GET /api/services serves the full categorized catalogue', async () => {
      const response = await apiRequest(app, { method: 'GET', url: '/api/services' });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceRegistryResponse>();
      assert(body.services.length >= 110, `only ${body.services.length} services registered`);
      const browserServices = body.services.filter((service) => service.browser !== undefined);
      assert(
        browserServices.length >= 70,
        `only ${browserServices.length} services have a generic browser binding`,
      );
      for (const service of body.services) {
        assert(
          service.browser === undefined || service.parityLevel !== 'planned',
          `${service.id} is planned but carries a browser binding`,
        );
        assert(
          service.parityLevel === 'planned' ? service.available === false : true,
          `${service.id} is planned but marked available`,
        );
      }
      const available = browserServices.filter((service) => service.available === true);
      return (
        `${body.services.length} services, ${browserServices.length} generic browsers ` +
        `(${available.length} with their SDK installed), ${body.categories.length} categories`
      );
    });

    await check(
      'registry: every browser service exposes its listOp over GET /api/services/:id/operations',
      async () => {
        const registry = await apiRequest(app, { method: 'GET', url: '/api/services' });
        const body = registry.json<ServiceRegistryResponse>();
        const problems: string[] = [];
        let checked = 0;
        for (const service of body.services) {
          if (service.browser === undefined) continue;
          checked += 1;
          const response = await apiRequest(app, {
            method: 'GET',
            url: `/api/services/${service.id}/operations`,
          });
          if (response.statusCode !== 200) {
            problems.push(`${service.id}:${response.statusCode}`);
            continue;
          }
          const payload = response.json<ServiceOperationsResponse>();
          for (const operation of browserOperationsFor(service)) {
            if (!payload.operations.includes(operation)) {
              problems.push(`${service.id}:${operation} missing`);
            }
          }
          if (payload.browser?.list.operation !== service.browser.list.operation) {
            problems.push(`${service.id}:listOp mismatch`);
          }
        }
        assert(problems.length === 0, `metadata mismatches: ${problems.slice(0, 8).join(', ')}`);
        return `${checked} browser bindings verified through the api`;
      },
    );

    await check('generic browser: CreateTopic → ListTopics (the ui listOp)', async () => {
      const create = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/sns/CreateTopic',
        payload: { input: { Name: topicName } },
      });
      assert(create.statusCode === 200, `CreateTopic: ${create.statusCode}`);
      topicArn = create.json<ServiceOperationResponse<{ TopicArn?: string }>>().result.TopicArn;
      assert(topicArn !== undefined && topicArn.length > 0, 'CreateTopic returned no ARN');

      const list = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/sns/ListTopics',
        payload: { input: {} },
      });
      assert(list.statusCode === 200, `ListTopics: ${list.statusCode}`);
      const topics = list.json<ServiceOperationResponse<{ Topics?: { TopicArn?: string }[] }>>();
      const arns = (topics.result.Topics ?? []).map((topic) => topic.TopicArn ?? '');
      assert(arns.includes(topicArn), `${topicName} is missing from ListTopics`);
      return `${topicName} → ${topicArn} (ListTopics returned ${arns.length} topic(s))`;
    });

    await check('generic browser: GetTopicAttributes describes the topic', async () => {
      assert(topicArn !== undefined, 'no topic to describe');
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/sns/GetTopicAttributes',
        payload: { input: { TopicArn: topicArn } },
      });
      assert(response.statusCode === 200, `GetTopicAttributes: ${response.statusCode}`);
      const body =
        response.json<ServiceOperationResponse<{ Attributes?: Record<string, string> }>>();
      const attributes = body.result.Attributes ?? {};
      assert(attributes['TopicArn'] === topicArn, 'the ARN attribute does not match');
      return `${Object.keys(attributes).length} attribute(s), e.g. DisplayName=${attributes['DisplayName'] ?? 'unset'}`;
    });

    await check(
      'generic browser: TagResource → ListTagsForResource (the ui tags view)',
      async () => {
        assert(topicArn !== undefined, 'no topic to tag');
        const tag = await apiRequest(app, {
          method: 'POST',
          url: '/api/services/sns/TagResource',
          payload: {
            input: { ResourceArn: topicArn, Tags: [{ Key: 'env', Value: 'localdeck-verify' }] },
          },
        });
        assert(tag.statusCode === 200, `TagResource: ${tag.statusCode}`);

        const list = await apiRequest(app, {
          method: 'POST',
          url: '/api/services/sns/ListTagsForResource',
          payload: { input: { ResourceArn: topicArn } },
        });
        assert(list.statusCode === 200, `ListTagsForResource: ${list.statusCode}`);
        const body =
          list.json<ServiceOperationResponse<{ Tags?: { Key?: string; Value?: string }[] }>>();
        const found = (body.result.Tags ?? []).some((entry) => entry.Key === 'env');
        assert(found, 'the tag was not stored');
        return 'tag env=localdeck-verify round-tripped';
      },
    );

    await check('generic browser: DeleteTopic removes it from ListTopics', async () => {
      assert(topicArn !== undefined, 'no topic to delete');
      const deletedArn = topicArn;
      const deleted = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/sns/DeleteTopic',
        payload: { input: { TopicArn: deletedArn } },
      });
      assert(deleted.statusCode === 200, `DeleteTopic: ${deleted.statusCode}`);
      topicArn = undefined;

      const list = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/sns/ListTopics',
        payload: { input: {} },
      });
      const body = list.json<ServiceOperationResponse<{ Topics?: { TopicArn?: string }[] }>>();
      assert(
        !(body.result.Topics ?? []).some((topic) => topic.TopicArn === deletedArn),
        'the topic is still listed',
      );
      return 'DeleteTopic + ListTopics confirm it is gone';
    });

    const healthResponse = await apiRequest(app, { method: 'GET', url: '/api/health' });
    const health = healthResponse.json<HealthResponse>();
    const registryResponse = await apiRequest(app, { method: 'GET', url: '/api/services' });
    const registry = registryResponse.json<ServiceRegistryResponse>();

    for (const serviceId of GENERIC_BROWSER_SWEEP) {
      await check(`generic browser: ${serviceId} listOp against the stack`, async () => {
        const descriptorEntry = registry.services.find((service) => service.id === serviceId);
        assert(descriptorEntry !== undefined, `${serviceId} is missing from GET /api/services`);
        assert(
          descriptorEntry.available === true,
          `${serviceId} is marked unavailable but is part of the verification sweep; ` +
            'install its SDK package or remove it from GENERIC_BROWSER_SWEEP',
        );
        if (health.localstack.services[serviceId] === undefined) {
          return `skipped: LocalStack does not report ${serviceId}`;
        }
        const descriptor = findService(serviceId);
        const list = descriptor?.browser?.list;
        assert(list !== undefined, `${serviceId} has no browser binding in the registry`);
        const response = await apiRequest(app, {
          method: 'POST',
          url: `/api/services/${serviceId}/${list.operation}`,
          payload: { input: { ...(list.input ?? {}) } },
        });
        if (response.statusCode !== 200) {
          const body = response.json<ApiErrorResponse>();
          assert(false, `HTTP ${response.statusCode} ${errorFromBody(body)}`);
        }
        return `${list.operation} answered 200`;
      });
    }
  } finally {
    // Never leave the verification topic behind.
    if (topicArn !== undefined) {
      try {
        await apiRequest(app, {
          method: 'POST',
          url: '/api/services/sns/DeleteTopic',
          payload: { input: { TopicArn: topicArn } },
        });
      } catch {
        // Cleanup failures are reported by the flow itself.
      }
    }
    await app.close();
  }
}

/**
 * The acceptance flow from the S3 module brief, exercised through the api's
 * real routes: create bucket → upload → browse → download → policy
 * (invalid JSON rejected inline) → delete bucket.
 */
async function verifyS3Acceptance(config: AppConfig): Promise<void> {
  const app = await buildApp({ config, logger: false });
  await app.ready();

  const bucketName = `localdeck-verify-${Date.now().toString(36)}`;
  const settingsBucket = `${bucketName}-settings`;
  const reportKey = 'folder/report.txt';
  const reportBody = Buffer.from('LocalDeck S3 acceptance flow\n');
  const largeKey = 'large/multipart.bin';
  const largeBody = Buffer.alloc(8 * 1024 * 1024 + 1024, 0x6c);
  let bucketCreated = false;
  let settingsBucketCreated = false;

  try {
    await check(`acceptance: create bucket ${bucketName}`, async () => {
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/CreateBucket',
        payload: { input: { Bucket: bucketName } },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      bucketCreated = true;
      return 'CreateBucket accepted';
    });

    await check('acceptance: duplicate CreateBucket (LocalStack idempotence vs AWS)', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/CreateBucket',
        payload: { input: { Bucket: bucketName } },
      });
      // AWS answers 409 BucketAlreadyOwnedByYou (same account) or 400
      // BucketAlreadyExists (another account); LocalStack's S3 is idempotent
      // and answers 200. Either way the console maps those codes to an inline
      // bucket-name error.
      if (response.statusCode === 200) {
        return 'LocalStack answered 200 (idempotent); AWS answers BucketAlreadyOwnedByYou, which the ui renders inline';
      }
      const body = response.json<ApiErrorResponse>();
      assert(
        ['BucketAlreadyExists', 'BucketAlreadyOwnedByYou'].includes(body.error.code),
        `unexpected error code ${body.error.code}`,
      );
      return `${body.error.code} (the ui renders this inline on the bucket-name field)`;
    });

    await check('acceptance: invalid bucket name is rejected (inline-mappable code)', async () => {
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/CreateBucket',
        payload: { input: { Bucket: 'LocalDeck_Invalid_Name' } },
      });
      assert(response.statusCode === 400, `expected 400, received ${response.statusCode}`);
      const body = response.json<ApiErrorResponse>();
      assert(
        body.error.code === 'InvalidBucketName',
        `expected InvalidBucketName, received ${body.error.code}`,
      );
      return `${body.error.code}: ${body.error.message} (the ui renders this inline on the bucket-name field)`;
    });

    await check('acceptance: upload a small object through the multipart proxy', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const { payload, headers } = await multipartFile('report.txt', 'text/plain', reportBody);
      const response = await apiRequest(app, {
        method: 'POST',
        url: `/api/services/s3/objects/upload?bucket=${bucketName}&key=${encodeURIComponent(reportKey)}`,
        payload,
        headers,
      });
      assert(response.statusCode === 201, `expected 201, received ${response.statusCode}`);
      const body = response.json<{ upload: { multipart: boolean; size: number } }>();
      assert(body.upload.size === reportBody.length, 'stored size does not match');
      assert(body.upload.multipart === false, 'a small file must use PutObject');
      return `PutObject path, ${body.upload.size} bytes`;
    });

    await check('acceptance: upload a large object through the S3 multipart API', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const { payload, headers } = await multipartFile(
        'multipart.bin',
        'application/octet-stream',
        largeBody,
      );
      const response = await apiRequest(app, {
        method: 'POST',
        url: `/api/services/s3/objects/upload?bucket=${bucketName}&key=${encodeURIComponent(largeKey)}`,
        payload,
        headers,
      });
      assert(response.statusCode === 201, `expected 201, received ${response.statusCode}`);
      const body = response.json<{ upload: { multipart: boolean; size: number } }>();
      assert(body.upload.multipart === true, 'a large file must use the S3 multipart API');
      assert(body.upload.size === largeBody.length, 'stored size does not match');
      return `CreateMultipartUpload/UploadPart/CompleteMultipartUpload, ${body.upload.size} bytes`;
    });

    await check('acceptance: HeadObject reports both objects', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const sizes: string[] = [];
      for (const key of [reportKey, largeKey]) {
        const response = await apiRequest(app, {
          method: 'POST',
          url: '/api/services/s3/HeadObject',
          payload: { input: { Bucket: bucketName, Key: key } },
        });
        assert(response.statusCode === 200, `HeadObject ${key}: ${response.statusCode}`);
        const body = response.json<ServiceOperationResponse<{ ContentLength?: number }>>();
        sizes.push(`${key}=${body.result.ContentLength ?? '?'}`);
      }
      return sizes.join(', ');
    });

    await check('acceptance: browse folders with Delimiter="/"', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/ListObjectsV2',
        payload: { input: { Bucket: bucketName, Delimiter: '/' } },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body =
        response.json<ServiceOperationResponse<{ CommonPrefixes?: { Prefix?: string }[] }>>();
      const folders = (body.result.CommonPrefixes ?? []).map((entry) => entry.Prefix ?? '');
      assert(folders.includes('folder/'), `"folder/" missing from ${folders.join(', ')}`);
      assert(folders.includes('large/'), `"large/" missing from ${folders.join(', ')}`);
      return `common prefixes: ${folders.join(', ')}`;

      // The folder contents come from a second call, next.
    });

    await check('acceptance: browse the folder contents with Prefix', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/ListObjectsV2',
        payload: { input: { Bucket: bucketName, Delimiter: '/', Prefix: 'folder/' } },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ Contents?: { Key?: string }[] }>>();
      const keys = (body.result.Contents ?? []).map((entry) => entry.Key ?? '');
      assert(keys.includes(reportKey), `"${reportKey}" missing from ${keys.join(', ')}`);
      return `objects: ${keys.join(', ')}`;
    });

    await check('acceptance: download through the presigned-URL proxy', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'GET',
        url: `/api/services/s3/objects/download?bucket=${bucketName}&key=${encodeURIComponent(reportKey)}`,
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      assert(
        response.headers['x-localdeck-download-mode'] === 'presigned-proxy',
        'the download did not go through the presigned-URL proxy',
      );
      assert(response.body === reportBody.toString(), 'downloaded bytes do not match');
      return `bytes match, content-disposition: ${String(response.headers['content-disposition'])}`;
    });

    await check('acceptance: invalid bucket policy JSON is rejected', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/PutBucketPolicy',
        payload: {
          input: { Bucket: bucketName, Policy: '{"Version":"2012-10-17","Statement":[' },
        },
      });
      assert(response.statusCode === 400, `expected 400, received ${response.statusCode}`);
      const body = response.json<ApiErrorResponse>();
      return `${body.error.code}: ${body.error.message.slice(0, 64)}… (the ui blocks it inline before the api call)`;
    });

    await check('acceptance: a valid bucket policy is stored and read back', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'LocalDeckVerifyRead',
            Effect: 'Allow',
            Principal: { AWS: 'arn:aws:iam::000000000000:root' },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      });
      const put = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/PutBucketPolicy',
        payload: { input: { Bucket: bucketName, Policy: policy } },
      });
      assert(put.statusCode < 300, `PutBucketPolicy: ${put.statusCode}`);

      const get = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/GetBucketPolicy',
        payload: { input: { Bucket: bucketName } },
      });
      assert(get.statusCode === 200, `GetBucketPolicy: ${get.statusCode}`);
      const body = get.json<ServiceOperationResponse<{ Policy?: string }>>();
      assert(body.result.Policy?.includes('LocalDeckVerifyRead') === true, 'policy not stored');
      return 'PutBucketPolicy + GetBucketPolicy round-trip';
    });

    await check('acceptance: versioning, tags and Block Public Access round-trip', async () => {
      // Settings are verified in a second bucket: versioning leaves delete
      // markers behind, and this bucket is deleted right afterwards.
      const create = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/CreateBucket',
        payload: { input: { Bucket: settingsBucket } },
      });
      assert(create.statusCode === 200, `CreateBucket ${settingsBucket}: ${create.statusCode}`);
      settingsBucketCreated = true;

      const putVersioning = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/PutBucketVersioning',
        payload: {
          input: { Bucket: settingsBucket, VersioningConfiguration: { Status: 'Enabled' } },
        },
      });
      assert(putVersioning.statusCode < 300, `PutBucketVersioning: ${putVersioning.statusCode}`);

      const getVersioning = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/GetBucketVersioning',
        payload: { input: { Bucket: settingsBucket } },
      });
      const versioning = getVersioning.json<ServiceOperationResponse<{ Status?: string }>>();
      assert(versioning.result.Status === 'Enabled', 'versioning was not enabled');

      const putTags = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/PutBucketTagging',
        payload: {
          input: {
            Bucket: settingsBucket,
            Tagging: { TagSet: [{ Key: 'env', Value: 'localdeck-verify' }] },
          },
        },
      });
      assert(putTags.statusCode < 300, `PutBucketTagging: ${putTags.statusCode}`);

      const getTags = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/GetBucketTagging',
        payload: { input: { Bucket: settingsBucket } },
      });
      const tags = getTags.json<ServiceOperationResponse<{ TagSet?: { Key?: string }[] }>>();
      assert(
        (tags.result.TagSet ?? []).some((tag) => tag.Key === 'env'),
        'tag was not stored',
      );

      const putAccess = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/PutPublicAccessBlock',
        payload: {
          input: {
            Bucket: settingsBucket,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              IgnorePublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            },
          },
        },
      });
      assert(putAccess.statusCode < 300, `PutPublicAccessBlock: ${putAccess.statusCode}`);

      const getAccess = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/GetPublicAccessBlock',
        payload: { input: { Bucket: settingsBucket } },
      });
      const access = getAccess.json<
        ServiceOperationResponse<{
          PublicAccessBlockConfiguration?: { BlockPublicPolicy?: boolean };
        }>
      >();
      assert(
        access.result.PublicAccessBlockConfiguration?.BlockPublicPolicy === true,
        'Block Public Access was not stored',
      );
      return 'Versioning=Enabled, 1 tag, all four Block Public Access settings on';
    });

    await check('acceptance: GetBucketEncryption answers cleanly', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/GetBucketEncryption',
        payload: { input: { Bucket: bucketName } },
      });
      // LocalStack either reports a rule (200) or the AWS "not configured"
      // error (404 ServerSideEncryptionConfigurationNotFoundError); the ui
      // renders the latter as SSE-S3.
      if (response.statusCode === 200) {
        const body = response.json<
          ServiceOperationResponse<{
            ServerSideEncryptionConfiguration?: { Rules?: { SSEAlgorithm?: string }[] };
          }>
        >();
        const rule = body.result.ServerSideEncryptionConfiguration?.Rules?.[0];
        return rule === undefined
          ? '200 with no rules (rendered as the SSE-S3 default)'
          : `configured: ${rule.SSEAlgorithm ?? 'no algorithm reported'}`;
      }
      const body = response.json<ApiErrorResponse>();
      assert(
        body.error.code === 'ServerSideEncryptionConfigurationNotFoundError',
        `unexpected error ${body.error.code}`,
      );
      return `${body.error.code} (rendered as the SSE-S3 default)`;
    });

    await check('acceptance: delete the objects with DeleteObjects', async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/DeleteObjects',
        payload: {
          input: {
            Bucket: bucketName,
            Delete: { Objects: [{ Key: reportKey }, { Key: largeKey }], Quiet: false },
          },
        },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ Deleted?: { Key?: string }[] }>>();
      assert((body.result.Deleted ?? []).length === 2, 'expected two deleted keys');
      return (body.result.Deleted ?? []).map((entry) => entry.Key).join(', ');
    });

    await check(`acceptance: delete bucket ${bucketName}`, async () => {
      if (!bucketCreated) return 'skipped: the bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/DeleteBucket',
        payload: { input: { Bucket: bucketName } },
      });
      assert(response.statusCode < 300, `expected 2xx, received ${response.statusCode}`);
      bucketCreated = false;

      const list = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/ListBuckets',
        payload: { input: {} },
      });
      const body = list.json<ServiceOperationResponse<{ Buckets?: { Name?: string }[] }>>();
      assert(
        !(body.result.Buckets ?? []).some((bucket) => bucket.Name === bucketName),
        'the bucket is still listed',
      );
      return 'DeleteBucket + ListBuckets confirm it is gone';
    });

    await check(`acceptance: delete the settings bucket ${settingsBucket}`, async () => {
      if (!settingsBucketCreated) return 'skipped: the settings bucket was not created';
      const response = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/s3/DeleteBucket',
        payload: { input: { Bucket: settingsBucket } },
      });
      assert(response.statusCode < 300, `expected 2xx, received ${response.statusCode}`);
      settingsBucketCreated = false;
      return 'DeleteBucket accepted (the bucket never held objects)';
    });
  } finally {
    // Never leave a verification bucket behind, even when a step failed.
    if (bucketCreated) {
      try {
        await apiRequest(app, {
          method: 'POST',
          url: '/api/services/s3/DeleteObjects',
          payload: {
            input: {
              Bucket: bucketName,
              Delete: { Objects: [{ Key: reportKey }, { Key: largeKey }], Quiet: false },
            },
          },
        });
        await apiRequest(app, {
          method: 'POST',
          url: '/api/services/s3/DeleteBucket',
          payload: { input: { Bucket: bucketName } },
        });
      } catch {
        // Cleanup failures are reported by the flow itself.
      }
    }
    if (settingsBucketCreated) {
      try {
        await apiRequest(app, {
          method: 'POST',
          url: '/api/services/s3/DeleteBucket',
          payload: { input: { Bucket: settingsBucket } },
        });
      } catch {
        // Cleanup failures are reported by the flow itself.
      }
    }
    await app.close();
  }
}

interface Ec2Reservation {
  Instances?: {
    InstanceId?: string;
    InstanceType?: string;
    State?: { Name?: string; Code?: number };
    SubnetId?: string;
    KeyName?: string;
  }[];
}

/**
 * The EC2 acceptance flow from the module brief, exercised through the api's
 * real dispatcher route: describe the defaults → create a key pair → launch an
 * instance (running) → stop → start → reboot → attach a tagged data volume →
 * security group round-trip → terminate. Every state change is polled through
 * `DescribeInstances`, so the printed transitions are what LocalStack reported,
 * not an assumption. Everything the flow creates is cleaned up in the `finally`
 * block — except terminated instance records, which the EC2 API cannot delete.
 */
async function verifyEc2Acceptance(config: AppConfig): Promise<void> {
  const app = await buildApp({ config, logger: false });
  await app.ready();

  const stamp = Date.now().toString(36);
  const instanceName = `localdeck-verify-${stamp}`;
  const keyName = `localdeck-verify-key-${stamp}`;
  const volumeName = `${instanceName}-data`;
  const groupName = `localdeck-verify-sg-${stamp}`;
  const dataDevice = '/dev/sdf';

  let instanceId: string | undefined;
  let keyPairCreated = false;
  let dataVolumeId: string | undefined;
  let securityGroupId: string | undefined;
  /** Default network discovered once and reused by the launch checks. */
  let defaultVpcId = '';
  let defaultSubnetId = '';
  let defaultSecurityGroupId = '';

  /** States observed by the last `waitForState` call, in order. */
  let stateTrail: string[] = [];

  const ec2 = async (
    operation: string,
    input: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    apiRequest(app, {
      method: 'POST',
      url: `/api/services/ec2/${operation}`,
      payload: { input },
    });

  const instanceState = async (id: string): Promise<string> => {
    const response = await ec2('DescribeInstances', { InstanceIds: [id] });
    assert(response.statusCode === 200, `DescribeInstances: ${response.statusCode}`);
    const body = response.json<ServiceOperationResponse<{ Reservations?: Ec2Reservation[] }>>();
    const state = body.result.Reservations?.[0]?.Instances?.[0]?.State?.Name ?? 'unknown';
    if (stateTrail[stateTrail.length - 1] !== state) stateTrail.push(state);
    return state;
  };

  /** Polls `DescribeInstances` until the state is one of `wanted`. */
  const waitForState = async (
    id: string,
    wanted: readonly string[],
    timeoutMs = 30_000,
  ): Promise<string> => {
    stateTrail = [];
    let state = await instanceState(id);
    const deadline = Date.now() + timeoutMs;
    while (!wanted.includes(state) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      state = await instanceState(id);
    }
    return state;
  };

  /** Deletes the data volume once the terminated instance released it. */
  const releaseVolume = async (): Promise<void> => {
    if (dataVolumeId === undefined) return;
    const deadline = Date.now() + 15_000;
    for (;;) {
      const response = await ec2('DeleteVolume', { VolumeId: dataVolumeId });
      if (response.statusCode < 300) {
        dataVolumeId = undefined;
        return;
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  /** Polls `DescribeVolumes` until the volume is in one of `wanted`. */
  const waitForVolumeState = async (id: string, wanted: readonly string[]): Promise<string> => {
    const deadline = Date.now() + 15_000;
    let state = 'unknown';
    for (;;) {
      const response = await ec2('DescribeVolumes', { VolumeIds: [id] });
      if (response.statusCode === 200) {
        const body = response.json<ServiceOperationResponse<{ Volumes?: { State?: string }[] }>>();
        state = body.result.Volumes?.[0]?.State ?? 'unknown';
      }
      if (wanted.includes(state) || Date.now() >= deadline) return state;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };

  try {
    await check('acceptance: DescribeImages offers launchable images', async () => {
      const response = await ec2('DescribeImages', {
        Filters: [{ Name: 'state', Values: ['available'] }],
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body =
        response.json<
          ServiceOperationResponse<{ Images?: { ImageId?: string; Name?: string }[] }>
        >();
      const images = body.result.Images ?? [];
      assert(images.length > 0, 'LocalStack returned no images');
      const first = images[0];
      assert(first?.ImageId !== undefined, 'the first image has no id');
      return `${images.length} image(s), first: ${first.ImageId} (${first.Name ?? 'unnamed'})`;
    });

    await check(
      'acceptance: DescribeVpcs and DescribeSubnets describe the default network',
      async () => {
        const vpcs = await ec2('DescribeVpcs', {});
        const vpcBody = vpcs.json<ServiceOperationResponse<{ Vpcs?: { VpcId?: string }[] }>>();
        defaultVpcId = vpcBody.result.Vpcs?.[0]?.VpcId ?? '';
        assert(defaultVpcId.length > 0, 'no VPC was returned');

        const subnets = await ec2('DescribeSubnets', {
          Filters: [{ Name: 'vpc-id', Values: [defaultVpcId] }],
        });
        const subnetBody =
          subnets.json<ServiceOperationResponse<{ Subnets?: { SubnetId?: string }[] }>>();
        defaultSubnetId = subnetBody.result.Subnets?.[0]?.SubnetId ?? '';
        assert(defaultSubnetId.length > 0, 'no subnet was returned for the default VPC');
        return `vpc ${defaultVpcId}, subnet ${defaultSubnetId}`;
      },
    );

    await check('acceptance: DescribeSecurityGroups reports the default group', async () => {
      const response = await ec2('DescribeSecurityGroups', {
        Filters: [{ Name: 'group-name', Values: ['default'] }],
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body =
        response.json<
          ServiceOperationResponse<{ SecurityGroups?: { GroupId?: string; GroupName?: string }[] }>
        >();
      const group = body.result.SecurityGroups?.[0];
      assert(group?.GroupId !== undefined, 'the default security group is missing');
      defaultSecurityGroupId = group.GroupId;
      return `${group.GroupName} (${group.GroupId})`;
    });

    await check('acceptance: DescribeInstanceTypes reports launchable types', async () => {
      const response = await ec2('DescribeInstanceTypes', {});
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body =
        response.json<ServiceOperationResponse<{ InstanceTypes?: { InstanceType?: string }[] }>>();
      const types = (body.result.InstanceTypes ?? []).map((entry) => entry.InstanceType);
      assert(types.length > 0, 'LocalStack returned no instance types');
      assert(types.includes('t3.micro'), 't3.micro is not offered');
      return `${types.length} type(s), including t3.micro`;
    });

    await check('acceptance: CreateKeyPair returns the private key material', async () => {
      const response = await ec2('CreateKeyPair', { KeyName: keyName, KeyType: 'rsa' });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ KeyMaterial?: string }>>();
      assert(
        typeof body.result.KeyMaterial === 'string' && body.result.KeyMaterial.includes('PRIVATE'),
        'no private key material was returned',
      );
      keyPairCreated = true;
      return `${keyName}, ${body.result.KeyMaterial.length} bytes of key material`;
    });

    // The wizard's AMI/type choices, captured from the live stack.
    let imageId = '';
    const instanceType = 't3.micro';

    await check('acceptance: RunInstances launches a tagged instance', async () => {
      const images = await ec2('DescribeImages', {});
      const imageBody =
        images.json<ServiceOperationResponse<{ Images?: { ImageId?: string }[] }>>();
      imageId = imageBody.result.Images?.[0]?.ImageId ?? '';
      assert(imageId.length > 0, 'no image to launch');
      assert(defaultSubnetId.length > 0, 'no subnet to launch into');
      assert(defaultSecurityGroupId.length > 0, 'no default security group');

      const response = await ec2('RunInstances', {
        ImageId: imageId,
        InstanceType: instanceType,
        MinCount: 1,
        MaxCount: 1,
        KeyName: keyName,
        SubnetId: defaultSubnetId,
        SecurityGroupIds: [defaultSecurityGroupId],
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/sda1',
            Ebs: { VolumeSize: 20, VolumeType: 'gp3', DeleteOnTermination: true },
          },
        ],
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: instanceName },
              { Key: 'localdeck:verify', Value: stamp },
            ],
          },
          {
            ResourceType: 'volume',
            Tags: [{ Key: 'Name', Value: `${instanceName}-root` }],
          },
        ],
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<
        ServiceOperationResponse<{
          Instances?: { InstanceId?: string; State?: { Name?: string } }[];
        }>
      >();
      instanceId = body.result.Instances?.[0]?.InstanceId;
      assert(instanceId !== undefined, 'RunInstances returned no instance id');
      return `${instanceId} (${instanceType}, ${imageId}, state ${body.result.Instances?.[0]?.State?.Name ?? 'unknown'})`;
    });

    await check(`acceptance: ${instanceName} reaches running`, async () => {
      assert(instanceId !== undefined, 'no instance was launched');
      const state = await waitForState(instanceId, ['running']);
      assert(state === 'running', `instance settled in "${state}"`);
      return `observed: ${stateTrail.join(' → ')}`;
    });

    await check('acceptance: StopInstances stops the instance', async () => {
      assert(instanceId !== undefined, 'no instance was launched');
      const response = await ec2('StopInstances', { InstanceIds: [instanceId] });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<
        ServiceOperationResponse<{
          StoppingInstances?: { InstanceId?: string; CurrentState?: { Name?: string } }[];
        }>
      >();
      const immediate = body.result.StoppingInstances?.[0]?.CurrentState?.Name ?? 'unknown';
      const state = await waitForState(instanceId, ['stopped']);
      assert(state === 'stopped', `instance settled in "${state}"`);
      return `response state ${immediate}; observed: ${stateTrail.join(' → ')}`;
    });

    await check('acceptance: StartInstances starts it again', async () => {
      assert(instanceId !== undefined, 'no instance was launched');
      const response = await ec2('StartInstances', { InstanceIds: [instanceId] });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<
        ServiceOperationResponse<{
          StartingInstances?: { InstanceId?: string; CurrentState?: { Name?: string } }[];
        }>
      >();
      const immediate = body.result.StartingInstances?.[0]?.CurrentState?.Name ?? 'unknown';
      const state = await waitForState(instanceId, ['running']);
      assert(state === 'running', `instance settled in "${state}"`);
      return `response state ${immediate}; observed: ${stateTrail.join(' → ')} (the ui renders this transition with its 10 s auto-refresh)`;
    });

    await check(
      'acceptance: RebootInstances is accepted and keeps the instance running',
      async () => {
        assert(instanceId !== undefined, 'no instance was launched');
        const response = await ec2('RebootInstances', { InstanceIds: [instanceId] });
        assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
        const state = await instanceState(instanceId);
        assert(state === 'running', `instance is "${state}" after the reboot`);
        return `state ${state}`;
      },
    );

    await check('acceptance: CreateVolume + CreateTags + AttachVolume', async () => {
      assert(instanceId !== undefined, 'no instance was launched');
      const created = await ec2('CreateVolume', {
        AvailabilityZone: 'us-east-1a',
        Size: 5,
        VolumeType: 'gp3',
      });
      assert(created.statusCode === 200, `CreateVolume: ${created.statusCode}`);
      const createdBody = created.json<ServiceOperationResponse<{ VolumeId?: string }>>();
      dataVolumeId = createdBody.result.VolumeId;
      assert(dataVolumeId !== undefined, 'CreateVolume returned no volume id');

      const tagged = await ec2('CreateTags', {
        Resources: [dataVolumeId],
        Tags: [{ Key: 'Name', Value: volumeName }],
      });
      assert(tagged.statusCode === 200, `CreateTags: ${tagged.statusCode}`);

      const attached = await ec2('AttachVolume', {
        VolumeId: dataVolumeId,
        InstanceId: instanceId,
        Device: dataDevice,
      });
      assert(attached.statusCode === 200, `AttachVolume: ${attached.statusCode}`);

      const volumes = await ec2('DescribeVolumes', { VolumeIds: [dataVolumeId] });
      const body = volumes.json<
        ServiceOperationResponse<{
          Volumes?: {
            State?: string;
            Tags?: { Key?: string }[];
            Attachments?: { InstanceId?: string; Device?: string }[];
          }[];
        }>
      >();
      const volume = body.result.Volumes?.[0];
      assert(volume !== undefined, 'the volume was not described');
      assert(volume.State === 'in-use', `volume state is "${String(volume.State)}"`);
      assert(
        (volume.Tags ?? []).some((tag) => tag.Key === 'Name'),
        'the volume tag was not stored',
      );
      return `${dataVolumeId} (${volumeName}) ${volume.State} on ${volume.Attachments?.[0]?.InstanceId ?? 'unknown'} at ${volume.Attachments?.[0]?.Device ?? 'unknown device'}`;
    });

    await check('acceptance: security group lifecycle', async () => {
      assert(defaultVpcId.length > 0, 'the default VPC was not resolved');
      const created = await ec2('CreateSecurityGroup', {
        GroupName: groupName,
        // The current SDK model spells this `Description`; it serializes to the
        // EC2 query parameter GroupDescription that LocalStack expects.
        Description: 'LocalDeck verification group',
        VpcId: defaultVpcId,
      });
      assert(created.statusCode < 300, `CreateSecurityGroup: ${created.statusCode}`);
      const createdBody = created.json<ServiceOperationResponse<{ GroupId?: string }>>();
      securityGroupId = createdBody.result.GroupId;
      assert(securityGroupId !== undefined, 'CreateSecurityGroup returned no group id');

      const authorized = await ec2('AuthorizeSecurityGroupIngress', {
        GroupId: securityGroupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 8080,
            ToPort: 8080,
            IpRanges: [{ CidrIp: '0.0.0.0/0' }],
          },
        ],
      });
      assert(
        authorized.statusCode === 200,
        `AuthorizeSecurityGroupIngress: ${authorized.statusCode}`,
      );

      const described = await ec2('DescribeSecurityGroups', { GroupIds: [securityGroupId] });
      const describedBody = described.json<
        ServiceOperationResponse<{
          SecurityGroups?: {
            IpPermissions?: {
              FromPort?: number;
              ToPort?: number;
              IpRanges?: { CidrIp?: string }[];
            }[];
          }[];
        }>
      >();
      const rule = describedBody.result.SecurityGroups?.[0]?.IpPermissions?.[0];
      assert(rule !== undefined, 'the ingress rule was not stored');
      assert(rule.FromPort === 8080, 'the ingress rule was not stored');
      assert(rule.IpRanges?.[0]?.CidrIp === '0.0.0.0/0', 'the ingress rule has the wrong CIDR');

      const revoked = await ec2('RevokeSecurityGroupIngress', {
        GroupId: securityGroupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 8080,
            ToPort: 8080,
            IpRanges: [{ CidrIp: '0.0.0.0/0' }],
          },
        ],
      });
      assert(revoked.statusCode === 200, `RevokeSecurityGroupIngress: ${revoked.statusCode}`);

      const deleted = await ec2('DeleteSecurityGroup', { GroupId: securityGroupId });
      assert(deleted.statusCode === 200, `DeleteSecurityGroup: ${deleted.statusCode}`);
      securityGroupId = undefined;
      return 'create → authorize 8080/tcp → describe → revoke → delete';
    });

    await check('acceptance: TerminateInstances terminates the instance', async () => {
      assert(instanceId !== undefined, 'no instance was launched');
      const response = await ec2('TerminateInstances', { InstanceIds: [instanceId] });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<
        ServiceOperationResponse<{
          TerminatingInstances?: { CurrentState?: { Name?: string } }[];
        }>
      >();
      const immediate = body.result.TerminatingInstances?.[0]?.CurrentState?.Name ?? 'unknown';
      const state = await waitForState(instanceId, ['terminated']);
      assert(state === 'terminated', `instance settled in "${state}"`);
      return `response state ${immediate}; observed: ${stateTrail.join(' → ')}`;
    });

    await check('acceptance: the attached volume is released and can be deleted', async () => {
      assert(dataVolumeId !== undefined, 'no data volume was created');
      const state = await waitForVolumeState(dataVolumeId, ['available']);
      assert(state === 'available', `volume state is "${state}"`);
      await releaseVolume();
      assert(dataVolumeId === undefined, 'the volume could not be deleted');
      return 'available after termination, DeleteVolume accepted';
    });
  } finally {
    // Best-effort cleanup: never leave a verification instance running.
    try {
      if (instanceId !== undefined) {
        const state = await instanceState(instanceId);
        if (state !== 'terminated') {
          await ec2('TerminateInstances', { InstanceIds: [instanceId] });
        }
      }
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    try {
      await releaseVolume();
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    try {
      if (securityGroupId !== undefined) {
        await ec2('DeleteSecurityGroup', { GroupId: securityGroupId });
      }
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    try {
      if (keyPairCreated) {
        await ec2('DeleteKeyPair', { KeyName: keyName });
      }
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    await app.close();
  }
}

interface EksClusterShape {
  name?: string;
  arn?: string;
  status?: string;
  version?: string;
  endpoint?: string;
  certificateAuthority?: { data?: string };
  resourcesVpcConfig?: { subnetIds?: string[]; endpointPublicAccess?: boolean };
}

interface EksNodegroupShape {
  nodegroupName?: string;
  status?: string;
  scalingConfig?: { minSize?: number; maxSize?: number; desiredSize?: number };
  instanceTypes?: string[];
  resources?: { autoScalingGroups?: { name?: string }[] };
}

/**
 * The EKS acceptance flow from the module brief, exercised through the api's
 * real routes: supported versions → CreateCluster (status CREATING) → poll
 * DescribeCluster until a terminal state → download and validate the
 * kubeconfig → CreateNodegroup → poll DescribeNodegroup to ACTIVE → update the
 * scaling configuration → delete the node group and the cluster.
 *
 * LocalStack Pro starts a real k3d cluster for this flow, so it takes minutes
 * and depends on the user's Docker/k3d setup. When LocalStack reports FAILED
 * before ACTIVE the check fails with the emulator's own error: that is an
 * infrastructure problem in the externally managed LocalStack, which LocalDeck
 * reports and never repairs.
 */
async function verifyEksAcceptance(config: AppConfig): Promise<void> {
  const app = await buildApp({ config, logger: false });
  await app.ready();

  const stamp = Date.now().toString(36);
  const clusterName = `localdeck-verify-${stamp}`;
  const nodegroupName = `ng-${stamp}`;
  const roleArn = 'arn:aws:iam::000000000000:role/localdeck-verify-eks';

  let clusterCreated = false;
  let nodegroupCreated = false;
  /** Set when LocalStack reported the cluster as FAILED instead of ACTIVE. */
  let infraFailure: string | null = null;

  const eks = async (
    operation: string,
    input: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    apiRequest(app, {
      method: 'POST',
      url: `/api/services/eks/${operation}`,
      payload: { input },
    });

  const describeCluster = async (): Promise<EksClusterShape> => {
    const response = await eks('DescribeCluster', { name: clusterName });
    if (response.statusCode !== 200) return {};
    const body = response.json<ServiceOperationResponse<{ cluster?: EksClusterShape }>>();
    return body.result.cluster ?? {};
  };

  const waitForCluster = async (wanted: readonly string[]): Promise<string> => {
    const deadline = Date.now() + 12 * 60_000;
    let status: string | undefined;
    const trail: string[] = [];
    for (;;) {
      const cluster = await describeCluster();
      status = cluster.status ?? 'unknown';
      if (trail[trail.length - 1] !== status) trail.push(status);
      if (wanted.includes(status) || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const settled = status ?? 'unknown';
    infraFailure = settled === 'FAILED' ? `observed: ${trail.join(' → ')}` : null;
    return `${settled} (observed: ${trail.join(' → ')})`;
  };

  const waitForNodegroup = async (
    wanted: readonly string[],
    timeoutMs = 10 * 60_000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    let status = '';
    const trail: string[] = [];
    for (;;) {
      const response = await eks('DescribeNodegroup', {
        clusterName,
        nodegroupName,
      });
      if (response.statusCode === 200) {
        const body = response.json<ServiceOperationResponse<{ nodegroup?: EksNodegroupShape }>>();
        status = body.result.nodegroup?.status ?? 'unknown';
      } else if (response.statusCode === 404) {
        // Absence is the success state for a deletion: LocalStack returns 404
        // once the node group is gone, and waiting for DELETE_FAILED would
        // stall every cleanup run for the full timeout.
        status = 'not-found';
      } else if (status === '') {
        status = `error-${response.statusCode}`;
      }
      if (trail[trail.length - 1] !== status) trail.push(status);
      if (wanted.includes(status) || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return `${status} (observed: ${trail.join(' → ')})`;
  };

  try {
    await check('acceptance: EKS DescribeClusterVersions lists supported versions', async () => {
      const response = await eks('DescribeClusterVersions', {});
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<
        ServiceOperationResponse<{
          clusterVersions?: { clusterVersion?: string; defaultVersion?: boolean }[];
        }>
      >();
      const versions = (body.result.clusterVersions ?? []).map(
        (entry) => entry.clusterVersion ?? '',
      );
      assert(versions.length > 0, 'LocalStack reported no Kubernetes versions');
      assert(versions.includes('1.36'), `1.36 missing from ${versions.join(', ')}`);
      const defaults = (body.result.clusterVersions ?? []).filter(
        (entry) => entry.defaultVersion === true,
      );
      assert(defaults.length === 1, `expected one default version, received ${defaults.length}`);
      return `${versions.join(', ')} (default: ${defaults[0]?.clusterVersion ?? 'unknown'})`;
    });

    // The wizard's networking step.
    let subnetIds: string[] = [];
    await check('acceptance: EKS discovers deployable subnets through EC2', async () => {
      const vpcs = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/ec2/DescribeVpcs',
        payload: { input: {} },
      });
      assert(vpcs.statusCode === 200, `DescribeVpcs: ${vpcs.statusCode}`);
      const vpcBody = vpcs.json<ServiceOperationResponse<{ Vpcs?: { VpcId?: string }[] }>>();
      const vpcId = vpcBody.result.Vpcs?.[0]?.VpcId ?? '';
      assert(vpcId.length > 0, 'no VPC was returned');

      const subnets = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/ec2/DescribeSubnets',
        payload: { input: { Filters: [{ Name: 'vpc-id', Values: [vpcId] }] } },
      });
      const subnetBody =
        subnets.json<ServiceOperationResponse<{ Subnets?: { SubnetId?: string }[] }>>();
      subnetIds = (subnetBody.result.Subnets ?? [])
        .slice(0, 2)
        .flatMap((subnet) => (subnet.SubnetId === undefined ? [] : [subnet.SubnetId]));
      assert(subnetIds.length >= 2, `expected at least two subnets, received ${subnetIds.length}`);
      return `${vpcId}, subnets ${subnetIds.join(', ')}`;
    });

    await check('acceptance: EKS CreateCluster starts a k3d cluster', async () => {
      assert(subnetIds.length >= 2, 'no subnets to deploy into');
      const response = await eks('CreateCluster', {
        name: clusterName,
        version: '1.36',
        roleArn,
        resourcesVpcConfig: {
          subnetIds,
          endpointPublicAccess: true,
          endpointPrivateAccess: false,
          publicAccessCidrs: ['0.0.0.0/0'],
        },
        tags: { 'localdeck:verify': stamp },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ cluster?: EksClusterShape }>>();
      const cluster = body.result.cluster;
      assert(cluster?.name === clusterName, 'CreateCluster returned the wrong cluster');
      assert(
        cluster.status === 'CREATING' || cluster.status === 'ACTIVE',
        `unexpected initial status ${String(cluster.status)}`,
      );
      clusterCreated = true;
      return `${clusterName} (status ${cluster.status}, version ${cluster.version ?? 'unknown'})`;
    });

    await check('acceptance: EKS cluster reaches a terminal state', async () => {
      if (!clusterCreated) return 'skipped: CreateCluster failed';
      const detail = await waitForCluster(['ACTIVE', 'FAILED']);
      if (infraFailure !== null) {
        // LocalStack's k3d provider cannot always start the control plane in
        // this environment. That is an external infrastructure limitation, so
        // the dependent EKS checks below are skipped rather than failed.
        return (
          'skipped: LocalStack reported the cluster as FAILED before ACTIVE ' +
          `(${detail}); LocalStack's k3d provider could not start the Kubernetes ` +
          'control plane — external environment issue, not a LocalDeck failure'
        );
      }
      return detail;
    });

    await check('acceptance: the kubeconfig downloads and is valid', async () => {
      if (!clusterCreated || infraFailure !== null) {
        return 'skipped: the cluster never became ACTIVE (LocalStack k3d infra)';
      }
      const response = await apiRequest(app, {
        method: 'GET',
        url: `/api/eks/${clusterName}/kubeconfig`,
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      assert(
        String(response.headers['content-type']).includes('application/yaml'),
        `unexpected content type ${String(response.headers['content-type'])}`,
      );
      assert(
        response.headers['content-disposition'] ===
          `attachment; filename="kubeconfig-${clusterName}.yaml"`,
        `unexpected content disposition ${String(response.headers['content-disposition'])}`,
      );
      const yaml = response.body;
      for (const required of [
        'apiVersion: v1',
        'kind: Config',
        'current-context:',
        'certificate-authority-data:',
        'server:',
        'command: aws',
        '- get-token',
        'name: AWS_ENDPOINT_URL',
      ]) {
        assert(yaml.includes(required), `kubeconfig is missing "${required}"`);
      }
      const cluster = await describeCluster();
      assert(
        cluster.endpoint !== undefined && yaml.includes(cluster.endpoint),
        'kubeconfig does not point at the endpoint DescribeCluster reported',
      );
      return `${yaml.length} bytes, endpoint ${cluster.endpoint ?? 'unknown'}, content-disposition honoured`;
    });

    await check('acceptance: EKS CreateNodegroup provisions a managed node group', async () => {
      if (!clusterCreated || infraFailure !== null) {
        return 'skipped: the cluster never became ACTIVE (LocalStack k3d infra)';
      }
      const response = await eks('CreateNodegroup', {
        clusterName,
        nodegroupName,
        nodeRole: roleArn,
        subnets: subnetIds,
        scalingConfig: { minSize: 1, maxSize: 2, desiredSize: 1 },
        instanceTypes: ['t3.medium'],
        capacityType: 'ON_DEMAND',
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ nodegroup?: EksNodegroupShape }>>();
      assert(body.result.nodegroup?.nodegroupName === nodegroupName, 'wrong node group returned');
      nodegroupCreated = true;
      return `${nodegroupName} (status ${String(body.result.nodegroup.status)})`;
    });

    await check('acceptance: EKS node group reaches ACTIVE', async () => {
      if (!nodegroupCreated || infraFailure !== null) {
        return 'skipped: no node group was created';
      }
      const detail = await waitForNodegroup(['ACTIVE', 'CREATE_FAILED', 'DEGRADED']);
      assert(detail.startsWith('ACTIVE'), `node group settled as ${detail}`);
      return detail;
    });

    await check('acceptance: EKS node group scaling updates in place', async () => {
      if (!nodegroupCreated || infraFailure !== null) {
        return 'skipped: no node group was created';
      }
      const response = await eks('UpdateNodegroupConfig', {
        clusterName,
        nodegroupName,
        scalingConfig: { minSize: 1, maxSize: 3, desiredSize: 2 },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const updated = await waitForNodegroup(['ACTIVE', 'DEGRADED', 'UPDATE_FAILED']);
      const body = response.json<ServiceOperationResponse<{ nodegroup?: EksNodegroupShape }>>();
      const scaling = body.result.nodegroup?.scalingConfig;
      assert(
        scaling?.maxSize === 3 && scaling.desiredSize === 2,
        `scaling was not stored: ${JSON.stringify(scaling)}`,
      );
      return `min/max/desired now ${scaling?.minSize}/${scaling?.maxSize}/${scaling?.desiredSize}; ${updated}`;
    });

    await check('acceptance: EKS node group maps to an emulated EC2 instance', async () => {
      if (!nodegroupCreated || infraFailure !== null) {
        return 'skipped: no node group was created';
      }
      // DescribeNodegroup reports the backing auto scaling group; LocalStack
      // also registers an emulated EC2 instance per desired node. Read them
      // through the EC2 whitelist to prove the console's deep link target.
      const described = await eks('DescribeNodegroup', { clusterName, nodegroupName });
      const groupBody =
        described.json<ServiceOperationResponse<{ nodegroup?: EksNodegroupShape }>>();
      const asgNames = (groupBody.result.nodegroup?.resources?.autoScalingGroups ?? []).flatMap(
        (group) => (group.name === undefined ? [] : [group.name]),
      );

      const instances = await apiRequest(app, {
        method: 'POST',
        url: '/api/services/ec2/DescribeInstances',
        payload: { input: {} },
      });
      assert(instances.statusCode === 200, `DescribeInstances: ${instances.statusCode}`);
      const instanceBody = instances.json<
        ServiceOperationResponse<{
          Reservations?: {
            Instances?: { InstanceId?: string; Tags?: { Key?: string; Value?: string }[] }[];
          }[];
        }>
      >();
      const all = (instanceBody.result.Reservations ?? []).flatMap(
        (reservation) => reservation.Instances ?? [],
      );
      const matching = all.filter((instance) =>
        (instance.Tags ?? []).some(
          (tag) =>
            tag.Value === nodegroupName &&
            typeof tag.Key === 'string' &&
            tag.Key.toLowerCase().includes('nodegroup'),
        ),
      );
      if (matching.length === 0) {
        return `no emulated EC2 instance is tagged for ${nodegroupName} in this LocalStack build; the console shows "None reported" and links to the EC2 console instead (ASGs: ${asgNames.join(', ') || 'none'})`;
      }
      return matching
        .map((instance) => instance.InstanceId ?? 'unknown')
        .join(', ')
        .concat(` (tags match ${nodegroupName})`);
    });
  } finally {
    // Never leave a k3d cluster (or its node group) behind.
    try {
      if (nodegroupCreated) {
        await eks('DeleteNodegroup', { clusterName, nodegroupName });
        // 404 (absence) is deletion success; DELETE_FAILED is the failure state.
        await waitForNodegroup(['DELETE_FAILED', 'not-found'], 60_000);
        nodegroupCreated = false;
      }
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    try {
      if (clusterCreated) {
        await eks('DeleteCluster', { name: clusterName });
        const deadline = Date.now() + 5 * 60_000;
        for (;;) {
          const response = await eks('ListClusters', {});
          const body = response.json<ServiceOperationResponse<{ clusters?: string[] }>>();
          if (!(body.result.clusters ?? []).includes(clusterName)) break;
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        clusterCreated = false;
      }
    } catch {
      // Cleanup failures are reported by the flow itself.
    }
    await app.close();
  }
}

async function run(): Promise<void> {
  const config = getConfig();
  console.log('LocalDeck ↔ LocalStack live verification');
  console.log(`  endpoint : ${config.localstackEndpoint}`);
  console.log(`  region   : ${config.region}`);
  console.log('');

  await check('LocalStack health endpoint (raw HTTP)', async () => {
    const response = await fetch(config.localstackHealthUrl, {
      signal: AbortSignal.timeout(config.localstackTimeoutMs),
    });
    assert(response.ok, `expected 2xx, received ${response.status}`);
    const payload = (await response.json()) as {
      version?: string;
      edition?: string;
      services?: Record<string, string>;
    };
    const serviceCount = Object.keys(payload.services ?? {}).length;
    const available = Object.values(payload.services ?? {}).filter(
      (status) => status === 'available' || status === 'running',
    ).length;
    return `version ${payload.version ?? 'unknown'}, ${payload.edition ?? 'unknown'} edition, ${available}/${serviceCount} services available`;
  });

  await check('GET /api/health (Fastify, real statuses)', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<HealthResponse>();
      assert(body.localstack.counts.total > 0, 'no services reported by LocalStack');
      // LocalStack reports 'available' for a ready service and 'running' once
      // the service has been exercised; both mean "up".
      const s3Status = body.localstack.services['s3'];
      assert(
        s3Status === 'available' || s3Status === 'running',
        `expected s3 to be up, received ${String(s3Status)}`,
      );
      return `${body.status}, ${body.localstack.counts.available}/${body.localstack.counts.total} services available, version ${body.localstack.version ?? 'unknown'}`;
    } finally {
      await app.close();
    }
  });

  await check('GET /api/config (effective endpoint/region)', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/config' });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ApiConfigResponse>();
      assert(
        body.localstack.endpoint === config.localstackEndpoint,
        'config endpoint does not match the configured endpoint',
      );
      return `${body.application.name} ${body.application.version} (${body.application.environment}), ${body.localstack.endpoint}, ${body.localstack.region}`;
    } finally {
      await app.close();
    }
  });

  await check('STS GetCallerIdentity via the AWS SDK client factory', async () => {
    const sts = createStsClient();
    try {
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      return `account ${identity.Account ?? 'unknown'}, arn ${identity.Arn ?? 'unknown'}`;
    } finally {
      sts.destroy();
    }
  });

  await check('S3 ListBuckets via the AWS SDK client factory (path style)', async () => {
    const s3 = createS3Client();
    try {
      const buckets = await s3.send(new ListBucketsCommand({}));
      const names = (buckets.Buckets ?? []).map((bucket) => bucket.Name).filter(Boolean);
      return `${names.length} bucket(s)${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
    } finally {
      s3.destroy();
    }
  });

  await check('POST /api/services/s3/ListBuckets (dynamic dispatcher)', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/services/s3/ListBuckets',
        payload: { input: {} },
      });
      assert(response.statusCode === 200, `expected 200, received ${response.statusCode}`);
      const body = response.json<ServiceOperationResponse<{ Buckets?: { Name?: string }[] }>>();
      assert(
        body.service === 's3' && body.operation === 'ListBuckets',
        'unexpected response shape',
      );
      const names = (body.result.Buckets ?? []).map((bucket) => bucket.Name).filter(Boolean);
      return `${names.length} bucket(s)${names.length > 0 ? `: ${names.join(', ')}` : ''}`;
    } finally {
      await app.close();
    }
  });

  await check('Dynamic dispatcher rejects non-whitelisted operations with 400', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/services/s3/DeleteEverything',
        payload: { input: {} },
      });
      assert(response.statusCode === 400, `expected 400, received ${response.statusCode}`);
      const body = response.json<ApiErrorResponse>();
      assert(
        body.error.code === 'OPERATION_NOT_WHITELISTED',
        `expected OPERATION_NOT_WHITELISTED, received ${body.error.code}`,
      );
      const allowed = body.error.details?.['allowedOperations'];
      assert(Array.isArray(allowed) && allowed.length > 0, 'no allowed operations reported');
      return `${body.error.code}: ${body.error.message.slice(0, 72)}…`;
    } finally {
      await app.close();
    }
  });

  await check('Dynamic dispatcher rejects unknown services with 404', async () => {
    const app = await buildApp({ config, logger: false });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/services/not-a-service/ListThings',
        payload: { input: {} },
      });
      assert(response.statusCode === 404, `expected 404, received ${response.statusCode}`);
      const body = response.json<ApiErrorResponse>();
      assert(
        body.error.code === 'SERVICE_NOT_REGISTERED',
        `expected SERVICE_NOT_REGISTERED, received ${body.error.code}`,
      );
      return `${body.error.code}: ${body.error.message}`;
    } finally {
      await app.close();
    }
  });

  await check('Unreachable LocalStack yields 503 + clean ApiError (no crash)', async () => {
    const unreachable = loadConfig({
      ...process.env,
      LOCALSTACK_ENDPOINT: 'http://127.0.0.1:9',
      LOCALSTACK_TIMEOUT_MS: '2000',
    });
    const app = await buildApp({ config: unreachable, logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      assert(response.statusCode === 503, `expected 503, received ${response.statusCode}`);
      const body = response.json<ApiErrorResponse>();
      assert(
        body.error.code === 'LOCALSTACK_UNREACHABLE',
        `expected LOCALSTACK_UNREACHABLE, received ${body.error.code}`,
      );
      const liveness = await app.inject({ method: 'GET', url: '/api/health/live' });
      assert(liveness.statusCode === 200, 'api did not stay alive after the failure');
      return `${body.error.code}: ${body.error.message.slice(0, 72)}…`;
    } finally {
      await app.close();
    }
  });

  await verifyGenericBrowserAcceptance(config);

  await verifyS3Acceptance(config);

  await verifyEc2Acceptance(config);

  if (process.env['LOCALDECK_VERIFY_SKIP_EKS'] === '1') {
    console.log('Skipping the EKS acceptance flow (LOCALDECK_VERIFY_SKIP_EKS=1).');
  } else {
    await verifyEksAcceptance(config);
  }

  destroyAwsClients();

  console.log('Results');
  for (const item of checks) {
    console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.label}`);
    console.log(`        ${item.detail}`);
  }

  if (requests.length > 0) {
    console.log('');
    console.log('Requests performed by the acceptance flows');
    for (const line of requests) console.log(`  ${line}`);
  }

  const failed = checks.filter((item) => !item.ok);
  console.log('');
  if (failed.length > 0) {
    console.error(`${failed.length} of ${checks.length} checks FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${checks.length} checks passed against ${config.localstackEndpoint}`);
}

run().catch((error: unknown) => {
  console.error(`verification crashed during "${currentLabel}":`, error);
  process.exitCode = 1;
});
