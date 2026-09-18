import { S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import { getConfig } from '../config.js';

/**
 * Base configuration shared by every AWS SDK v3 client in LocalDeck.
 *
 * All clients are built here so that endpoint, region, credentials and the
 * outbound HTTP timeouts come from exactly one place, and so S3 always uses
 * path-style addressing (the LocalStack S3 implementation does not do
 * virtual-host style routing).
 */
export interface AwsHttpHandlerOptions {
  /** Milliseconds allowed for establishing the TCP connection. */
  connectionTimeout: number;
  /** Milliseconds allowed for one request/response exchange. */
  requestTimeout: number;
  /**
   * Turn the requestTimeout into an error instead of a warning: without this
   * the SDK keeps waiting and a hung LocalStack holds the handler open.
   */
  throwOnRequestTimeout: boolean;
}

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
  /**
   * The generated clients accept either a `RequestHandler` instance or the
   * plain NodeHttpHandler options and construct the handler themselves
   * (`NodeHttpHandler.create(config.requestHandler)` in the client runtime
   * config). Passing options keeps `@smithy/node-http-handler` out of the
   * dependency list while still giving every call a connect/request timeout.
   */
  requestHandler: AwsHttpHandlerOptions;
}

export interface AwsClientConfigOverrides {
  region?: string;
  endpoint?: string;
  maxAttempts?: number;
  /** Overrides LOCALSTACK_CONNECTION_TIMEOUT_MS for this client. */
  connectionTimeoutMs?: number;
  /** Overrides LOCALSTACK_REQUEST_TIMEOUT_MS for this client. */
  requestTimeoutMs?: number;
}

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

/**
 * `maxAttempts: 3` is the SDK default and is safe for reads, but it also
 * replays non-idempotent mutations (RunInstances, CreateNodegroup, CreateKey,
 * Invoke, SendMessage) when a request fails after reaching LocalStack. LocalDeck
 * keeps the default because LocalStack answers those calls locally (no flaky
 * network) and the retry happens only before a response is read; an operator
 * managing a remote LocalStack can lower it per deployment by building clients
 * with `overrides.maxAttempts = 1`. Per-operation retry policy would require a
 * second client per package and is deliberately not done here.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

export function buildAwsClientConfig(overrides: AwsClientConfigOverrides = {}): AwsClientConfig {
  const config = getConfig();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  return {
    region: overrides.region ?? config.region,
    endpoint: overrides.endpoint ?? config.emulatorEndpoint,
    credentials: {
      accessKeyId: accessKeyId !== undefined && accessKeyId.length > 0 ? accessKeyId : 'test',
      secretAccessKey:
        secretAccessKey !== undefined && secretAccessKey.length > 0 ? secretAccessKey : 'test',
      ...(sessionToken !== undefined && sessionToken.length > 0 ? { sessionToken } : {}),
    },
    maxAttempts: overrides.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      connectionTimeout: overrides.connectionTimeoutMs ?? config.emulatorConnectionTimeoutMs,
      requestTimeout: overrides.requestTimeoutMs ?? config.emulatorRequestTimeoutMs,
      throwOnRequestTimeout: true,
    },
  };
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

/** Memoized clients, keyed by package + client class + endpoint/region. */
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
  return createAwsClientInstance(STSClient, { overrides });
}

export function createS3Client(overrides: AwsClientConfigOverrides = {}): S3Client {
  return createAwsClientInstance(S3Client, { forcePathStyle: true, overrides });
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

/**
 * Abort signal for one outbound SDK call: the caller's signal (client
 * disconnect / Fastify handler timeout) combined with a hard request timeout
 * derived from the same config the client's request handler uses.
 */
export function sdkAbortSignal(signal?: AbortSignal, requestTimeoutMs?: number): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMs ?? getConfig().emulatorRequestTimeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export function destroyAwsClients(): void {
  for (const client of createdClients) client.destroy();
  createdClients.clear();
  clientCache.clear();
}
