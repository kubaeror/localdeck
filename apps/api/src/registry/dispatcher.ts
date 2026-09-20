import {
  ApiErrorCodes,
  type ServiceDescriptor,
  type ServiceOperationResponse,
} from '@localdeck/shared';
import {
  createAwsClientInstance,
  getOrCreateAwsClient,
  sdkAbortSignal,
  usesPathStyleAddressing,
  type AwsClientConfigOverrides,
  type AwsSdkClient,
  type AwsSdkClientConstructor,
} from '../lib/awsClients.js';
import { ApiProblem, asApiProblem, isUnsupportedOperationError } from '../lib/errors.js';
import { requireServiceById } from './services.js';

/**
 * Dynamic AWS operation dispatcher.
 *
 * One route proxies any whitelisted operation of any registered service:
 * `POST /api/services/:serviceId/:operation`. The sdk package, the client class
 * and the command class are all resolved from the registry entry, and the
 * operation must appear in the registry's whitelist — which is the same list
 * each service module's `spec.ts` is validated against — or the request is
 * rejected with 400 before any SDK code runs.
 */

export interface ServiceOperationTarget {
  descriptor: ServiceDescriptor;
  operation: string;
  commandName: string;
}

/** Resolves and whitelists one operation, without touching the SDK. */
export function resolveServiceOperation(
  serviceId: string,
  operation: string,
): ServiceOperationTarget {
  const descriptor = requireServiceById(serviceId);

  if (!descriptor.operations.includes(operation)) {
    throw new ApiProblem({
      code: ApiErrorCodes.operationNotWhitelisted,
      statusCode: 400,
      message:
        `"${operation}" is not a whitelisted ${descriptor.displayName} operation. ` +
        `LocalDeck proxies: ${descriptor.operations.join(', ')}.`,
      service: descriptor.id,
      details: {
        service: descriptor.id,
        operation,
        allowedOperations: descriptor.operations,
      },
    });
  }

  return { descriptor, operation, commandName: `${operation}Command` };
}

const sdkModules = new Map<string, Promise<Record<string, unknown>>>();

/**
 * Imports the service's SDK package once per process. A package the api does
 * not depend on yet produces a clean 501 instead of a broken proxy.
 */
async function loadSdkModule(descriptor: ServiceDescriptor): Promise<Record<string, unknown>> {
  const cached = sdkModules.get(descriptor.sdkPackage);
  if (cached !== undefined) return cached;

  const loading = import(descriptor.sdkPackage)
    .then((module) => module as Record<string, unknown>)
    .catch((cause: unknown) => {
      sdkModules.delete(descriptor.sdkPackage);
      throw new ApiProblem({
        code: ApiErrorCodes.sdkPackageUnavailable,
        statusCode: 501,
        message:
          `The LocalDeck api does not have ${descriptor.sdkPackage} installed, so ` +
          `${descriptor.displayName} operations cannot be proxied yet. Install it with ` +
          `"pnpm --filter @localdeck/api add ${descriptor.sdkPackage}".`,
        service: descriptor.id,
        details: { sdkPackage: descriptor.sdkPackage, service: descriptor.id },
        cause,
      });
    });

  sdkModules.set(descriptor.sdkPackage, loading);
  return loading;
}

/** Picks the one `*Client` class an `@aws-sdk/client-*` package exports. */
function resolveClientConstructor(
  module: Record<string, unknown>,
  descriptor: ServiceDescriptor,
): AwsSdkClientConstructor {
  const packageName = descriptor.sdkPackage.replace(/^@aws-sdk\/client-/, '');
  const candidates = Object.keys(module)
    .filter(
      (name) =>
        name.endsWith('Client') &&
        // Smithy re-exports its base class as __Client.
        !name.startsWith('_') &&
        typeof module[name] === 'function',
    )
    .sort((left, right) => left.localeCompare(right, 'en'));

  // With more than one candidate (e.g. a legacy alias), prefer the class whose
  // name is derived from the package name: client-cloudwatch-logs → CloudWatchLogsClient.
  const normalizedPackage = packageName.replace(/-/g, '').toLowerCase();
  const preferred =
    candidates.length === 1
      ? candidates
      : candidates.filter(
          (name) =>
            name.slice(0, -'Client'.length).replace(/-/g, '').toLowerCase() === normalizedPackage,
        );

  const found = preferred.length === 1 ? module[preferred[0] as string] : undefined;
  if (found !== undefined && typeof found === 'function') {
    return found as AwsSdkClientConstructor;
  }

  throw new ApiProblem({
    code: ApiErrorCodes.sdkPackageUnavailable,
    statusCode: 501,
    message:
      candidates.length === 0
        ? `${descriptor.sdkPackage} does not export a client class, so ${descriptor.displayName} cannot be proxied.`
        : `${descriptor.sdkPackage} exports several client classes (${candidates.join(', ')}), so ` +
          `LocalDeck cannot pick one for ${descriptor.displayName}.`,
    service: descriptor.id,
    details: { sdkPackage: descriptor.sdkPackage, candidates },
  });
}

function resolveCommandConstructor(
  module: Record<string, unknown>,
  target: ServiceOperationTarget,
): new (input: Record<string, unknown>) => unknown {
  const command = module[target.commandName];
  if (typeof command !== 'function') {
    throw new ApiProblem({
      code: ApiErrorCodes.sdkPackageUnavailable,
      statusCode: 501,
      message:
        `${target.descriptor.sdkPackage} does not export ${target.commandName}, so ` +
        `"${target.operation}" cannot be proxied. Check the operation whitelist for ` +
        `${target.descriptor.displayName}.`,
      service: target.descriptor.id,
      details: {
        sdkPackage: target.descriptor.sdkPackage,
        operation: target.operation,
        allowedOperations: target.descriptor.operations,
      },
    });
  }
  return command as new (input: Record<string, unknown>) => unknown;
}

/**
 * Sends one whitelisted operation to LocalStack and returns the raw SDK
 * response. SDK failures bubble up to the Fastify error handler, which maps
 * them onto the shared ApiError contract.
 *
 * `overrides` carries the endpoint/region/timeouts the running app was
 * configured with, so the dispatcher always talks to the same LocalStack as
 * `/api/health`. `dependencies` exists for tests: they can inject a fake SDK
 * module map and a request abort signal without touching the real registry.
 */
export interface DispatcherDependencies {
  /** Replaces the dynamic `import(sdkPackage)` used in production. */
  loadSdkModule?: (descriptor: ServiceDescriptor) => Promise<Record<string, unknown>>;
  /** Caller-provided abort signal (client disconnect, handler timeout). */
  signal?: AbortSignal;
}

const MAX_SANITIZE_DEPTH = 24;

function isNodeStream(value: object): value is { destroy?: () => void; pipe: unknown } {
  const record = value as Record<string, unknown>;
  return typeof record.pipe === 'function' && typeof record.on === 'function';
}

/**
 * Makes an SDK result safe for the JSON dispatcher:
 *
 * - `Uint8Array`/`ArrayBuffer` blobs (Kinesis records, Lambda payloads) become
 *   base64 strings instead of `{"0":…}` objects.
 * - Node streams (S3 `GetObject.Body`) are destroyed and rejected with a clean
 *   501, because buffering an arbitrarily large object into JSON is never
 *   right and the dedicated object proxy is the supported path.
 * - Plain objects/arrays are cloned; values with a custom prototype (Date, …)
 *   are passed through so their `toJSON` still works.
 */
export function sanitizeDispatcherResult(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value)).toString('base64');

  if (isNodeStream(value)) {
    // Do not leave the response body socket dangling.
    try {
      (value as { destroy?: () => void }).destroy?.();
    } catch {
      // The clean 501 is what matters; a destroy failure is not actionable.
    }
    throw new ApiProblem({
      code: ApiErrorCodes.binaryResponseUnsupported,
      statusCode: 501,
      message:
        'The operation returned a streaming payload, which the JSON dispatcher cannot carry. ' +
        'Use the dedicated S3 object routes for object downloads.',
      details: { kind: 'stream' },
    });
  }

  if (depth > MAX_SANITIZE_DEPTH) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDispatcherResult(entry, seen, depth + 1));
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    // Date and other toJSON-aware values serialize correctly on their own.
    return value;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    // defineProperty, not assignment: an SDK result map may contain a
    // `__proto__` key (DynamoDB attribute, S3 metadata, Lambda env var) which
    // assignment would silently drop and turn into a prototype mutation.
    Object.defineProperty(clone, key, {
      value: sanitizeDispatcherResult(entry, seen, depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return clone;
}

/**
 * Operations an emulator has already answered "not implemented" for, keyed by
 * endpoint+service+operation. LocalStack, MiniStack and Floci implement
 * different operation subsets; once one rejects an operation, the ui disables
 * it instead of repeating a doomed call. Bounded so a long session cannot grow
 * the map without limit.
 */
const unsupportedOperations = new Map<string, string>();
const UNSUPPORTED_CACHE_LIMIT = 500;

function unsupportedKey(
  overrides: AwsClientConfigOverrides,
  serviceId: string,
  operation: string,
): string {
  return `${overrides.endpoint ?? ''}|${serviceId}|${operation}`;
}

/** Test hook: forget learned unsupported operations. */
export function resetUnsupportedOperationCache(): void {
  unsupportedOperations.clear();
}

function rememberUnsupported(key: string, message: string): void {
  if (unsupportedOperations.size >= UNSUPPORTED_CACHE_LIMIT) {
    const oldest = unsupportedOperations.keys().next().value;
    if (oldest !== undefined) unsupportedOperations.delete(oldest);
  }
  unsupportedOperations.set(key, message);
}

export async function dispatchServiceOperation(
  serviceId: string,
  operation: string,
  input: Record<string, unknown>,
  overrides: AwsClientConfigOverrides = {},
  dependencies: DispatcherDependencies = {},
): Promise<ServiceOperationResponse> {
  const target = resolveServiceOperation(serviceId, operation);

  if (target.descriptor.parityLevel === 'planned') {
    throw new ApiProblem({
      code: ApiErrorCodes.servicePlanned,
      statusCode: 501,
      message:
        `${target.descriptor.displayName} is registered as a navigation placeholder in ` +
        'LocalDeck and exposes no proxied operations yet.',
      service: target.descriptor.id,
      details: { service: target.descriptor.id, parityLevel: 'planned' },
    });
  }

  const learnedKey = unsupportedKey(overrides, serviceId, operation);
  const learned = unsupportedOperations.get(learnedKey);
  if (learned !== undefined) {
    throw new ApiProblem({
      code: ApiErrorCodes.emulatorOperationUnsupported,
      statusCode: 501,
      message:
        `"${target.descriptor.displayName}" does not implement "${operation}" on the active ` +
        'local emulator; the action is disabled after the first rejection.',
      service: target.descriptor.id,
      details: {
        service: target.descriptor.id,
        operation,
        reason: 'learned-unsupported',
        upstreamMessage: learned,
      },
    });
  }

  const loadModule = dependencies.loadSdkModule ?? loadSdkModule;
  const module = await loadModule(target.descriptor);
  const ClientConstructor = resolveClientConstructor(module, target.descriptor);

  const client: AwsSdkClient = getOrCreateAwsClient(
    `${target.descriptor.sdkPackage}:${ClientConstructor.name}:${overrides.region ?? ''}:${overrides.endpoint ?? ''}`,
    () =>
      createAwsClientInstance(ClientConstructor, {
        forcePathStyle: usesPathStyleAddressing(target.descriptor.sdkPackage),
        overrides,
      }),
  );

  const Command = resolveCommandConstructor(module, target);

  let result: unknown;
  try {
    result = await client.send(new Command(input), {
      // A hung emulator must not hold the handler open, and a browser that
      // goes away must cancel the upstream call.
      abortSignal: sdkAbortSignal(dependencies.signal, overrides.requestTimeoutMs),
    });
  } catch (error) {
    if (isUnsupportedOperationError(error)) {
      rememberUnsupported(learnedKey, error instanceof Error ? error.message : String(error));
    }
    // `asApiProblem` maps SDK/network/serializer failures and fills in
    // `ApiError.service` from the registry descriptor (Smithy never writes
    // `$service` on real errors). The operation is passed so unsupported
    // operations get an actionable message.
    throw asApiProblem(error, {
      ...(overrides.endpoint === undefined ? {} : { endpoint: overrides.endpoint }),
      service: target.descriptor.id,
      operation: target.operation,
    });
  }

  return {
    service: target.descriptor.id,
    operation: target.operation,
    result: sanitizeDispatcherResult(result),
  };
}
