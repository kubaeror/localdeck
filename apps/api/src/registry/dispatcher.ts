import {
  ApiErrorCodes,
  type ServiceDescriptor,
  type ServiceOperationResponse,
} from '@localdeck/shared';
import {
  createAwsClientInstance,
  getOrCreateAwsClient,
  usesPathStyleAddressing,
  type AwsClientConfigOverrides,
  type AwsSdkClient,
  type AwsSdkClientConstructor,
} from '../lib/awsClients.js';
import { ApiProblem } from '../lib/errors.js';
import { requireServiceById } from './services.js';

/**
 * Dynamic AWS operation dispatcher.
 *
 * One route proxies any whitelisted operation of any registered service:
 * `POST /api/services/:service/:operation`. The sdk package, the client class
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
 * `overrides` carries the endpoint/region the running app was configured with,
 * so the dispatcher always talks to the same LocalStack as `/api/health`.
 */
export async function dispatchServiceOperation(
  serviceId: string,
  operation: string,
  input: Record<string, unknown>,
  overrides: AwsClientConfigOverrides = {},
): Promise<ServiceOperationResponse> {
  const target = resolveServiceOperation(serviceId, operation);
  const module = await loadSdkModule(target.descriptor);
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
  const result = await client.send(new Command(input));

  return {
    service: target.descriptor.id,
    operation: target.operation,
    result,
  };
}
