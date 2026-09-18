import { S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import { getConfig } from '../config.js';

/**
 * Base configuration shared by every AWS SDK v3 client in LocalDeck.
 *
 * All clients are built here so that endpoint, region and credentials come
 * from exactly one place, and so S3 always uses path-style addressing (the
 * LocalStack S3 implementation does not do virtual-host style routing).
 */
export interface AwsClientConfig {
  region: string;
  endpoint: string;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  maxAttempts: number;
  /**
   * LocalStack is lenient about the newer default flexible-checksum behavior;
   * asking for checksums only when an operation requires them keeps S3
   * payloads byte-for-byte what the caller sent.
   */
  requestChecksumCalculation: 'WHEN_REQUIRED';
  responseChecksumValidation: 'WHEN_REQUIRED';
}

export type AwsClientConfigOverrides = Partial<
  Pick<AwsClientConfig, 'region' | 'endpoint' | 'maxAttempts'>
>;

/** The slice of an SDK client LocalDeck uses: send a command, then destroy it. */
export interface AwsSdkClient {
  send(command: unknown, options?: unknown): Promise<unknown>;
  destroy(): void;
}

/**
 * Constructor shape of any generated `@aws-sdk/client-*` package. The
 * dispatcher passes classes it loaded at runtime, so this is the only contract
 * it needs.
 */
export type AwsSdkClientConstructor = new (config: AwsClientConfig) => AwsSdkClient;

export function buildAwsClientConfig(overrides: AwsClientConfigOverrides = {}): AwsClientConfig {
  const config = getConfig();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  return {
    region: overrides.region ?? config.region,
    endpoint: overrides.endpoint ?? config.localstackEndpoint,
    credentials: {
      accessKeyId: accessKeyId !== undefined && accessKeyId.length > 0 ? accessKeyId : 'test',
      secretAccessKey:
        secretAccessKey !== undefined && secretAccessKey.length > 0 ? secretAccessKey : 'test',
      ...(sessionToken !== undefined && sessionToken.length > 0 ? { sessionToken } : {}),
    },
    maxAttempts: overrides.maxAttempts ?? 3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

/** Single construction point for SDK clients: pass a factory, get a client. */
export function createAwsClient<TClient>(
  factory: (config: AwsClientConfig) => TClient,
  overrides: AwsClientConfigOverrides = {},
): TClient {
  return factory(buildAwsClientConfig(overrides));
}

/**
 * LocalStack serves S3 (and S3 Control) path-style: the bucket is part of the
 * path, never the host name.
 */
const PATH_STYLE_PACKAGES = new Set(['@aws-sdk/client-s3', '@aws-sdk/client-s3-control']);

export function usesPathStyleAddressing(sdkPackage: string): boolean {
  return PATH_STYLE_PACKAGES.has(sdkPackage);
}

export interface AwsClientInstanceOptions {
  overrides?: AwsClientConfigOverrides;
  /** Force `forcePathStyle: true` (set for S3 packages by the dispatcher). */
  forcePathStyle?: boolean;
}

/** Every client ever created here, so shutdown can destroy all of them. */
const createdClients = new Set<AwsSdkClient>();

/**
 * Creates one client instance through the shared configuration. Used by the
 * static helpers below and by the dynamic service dispatcher; nothing else in
 * the codebase constructs an AWS SDK client.
 */
export function createAwsClientInstance<TClient extends AwsSdkClient>(
  Client: new (config: AwsClientConfig) => TClient,
  options: AwsClientInstanceOptions = {},
): TClient {
  const config = buildAwsClientConfig(options.overrides ?? {});

  if (options.forcePathStyle === true) {
    // Held in a variable so the extra `forcePathStyle` key is not treated as an
    // excess property: S3 clients accept it, the base config type does not.
    const pathStyleConfig: AwsClientConfig & { forcePathStyle: boolean } = {
      ...config,
      forcePathStyle: true,
    };
    const client = new Client(pathStyleConfig);
    createdClients.add(client);
    return client;
  }

  const client = new Client(config);
  createdClients.add(client);
  return client;
}

/** Memoized clients, keyed by package + client class. */
const clientCache = new Map<string, AwsSdkClient>();

/** Returns the cached client for `cacheKey`, creating it on first use. */
export function getOrCreateAwsClient<TClient extends AwsSdkClient>(
  cacheKey: string,
  build: () => TClient,
): TClient {
  const cached = clientCache.get(cacheKey);
  if (cached !== undefined) return cached as TClient;
  const client = build();
  clientCache.set(cacheKey, client);
  return client;
}

export function createStsClient(overrides: AwsClientConfigOverrides = {}): STSClient {
  return createAwsClient((config) => new STSClient(config), overrides);
}

export function createS3Client(overrides: AwsClientConfigOverrides = {}): S3Client {
  return createAwsClient((config) => new S3Client({ ...config, forcePathStyle: true }), overrides);
}

let stsClient: STSClient | undefined;
let s3Client: S3Client | undefined;

/** Memoized clients for request handlers; call destroyAwsClients() on shutdown. */
export function getStsClient(): STSClient {
  stsClient ??= createStsClient();
  return stsClient;
}

export function getS3Client(): S3Client {
  s3Client ??= createS3Client();
  return s3Client;
}

/**
 * S3 client for the dedicated object-proxy routes, memoized per
 * endpoint/region exactly like the dispatcher's dynamic clients. Both paths go
 * through `createAwsClientInstance`, so `forcePathStyle: true` is applied in
 * one place for every S3 call LocalDeck makes.
 */
export function getS3ClientFor(overrides: AwsClientConfigOverrides = {}): S3Client {
  return getOrCreateAwsClient(
    `@aws-sdk/client-s3:S3Client:${overrides.region ?? ''}:${overrides.endpoint ?? ''}`,
    () => createAwsClientInstance(S3Client, { forcePathStyle: true, overrides }),
  );
}

export function destroyAwsClients(): void {
  stsClient?.destroy();
  s3Client?.destroy();
  stsClient = undefined;
  s3Client = undefined;

  for (const client of createdClients) client.destroy();
  createdClients.clear();
  clientCache.clear();
}
