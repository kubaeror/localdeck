import { findService, type ServiceDescriptor } from './services.js';

/**
 * What a service module can do in the console. Modules declare this in their
 * own `spec.ts`; the api enforces the registry's operation whitelist, and this
 * capability metadata drives what the ui renders (list, detail, create).
 */
export interface ServiceCapabilities {
  list: boolean;
  detail: boolean;
  create: boolean;
}

/** The standard page kinds every module can implement (list, detail, create). */
export type ServicePageKind = 'list' | 'detail' | 'create';

/**
 * Key of a page component in `UiServiceModule.pages`. Modules normally use the
 * standard kinds; a service with several resource types (IAM has users, groups,
 * roles and policies) declares one id per view, so the route's `page` is a
 * free-form id that the shell looks up in the module's page map.
 */
export type ServicePageId = ServicePageKind | (string & {});

export interface ServicePageRoute {
  /** Path relative to `/console/<serviceId>`; `''` is the index route. */
  path: string;
  /** Breadcrumb title for the route. */
  title: string;
  page: ServicePageId;
}

/**
 * Capability metadata for one service module: the registry entry it belongs to,
 * the operations it actually calls (a subset of the registry whitelist, which
 * `createServiceSpec` verifies at module load) and what the console may render.
 */
export interface ServiceSpec {
  descriptor: ServiceDescriptor;
  /** Whitelisted operations this module calls, in the registry's spelling. */
  operations: readonly string[];
  capabilities: ServiceCapabilities;
}

export interface ServiceModule {
  descriptor: ServiceDescriptor;
  /** Capability metadata declared by the module's spec.ts. */
  spec: ServiceSpec;
  /** Routes the console mounts under `/console/<serviceId>`. */
  routes: readonly ServicePageRoute[];
}

export interface ServiceSpecInput {
  /** Operations the module calls; defaults to none (a scaffold). */
  operations?: readonly string[];
  capabilities?: Partial<ServiceCapabilities>;
}

const DEFAULT_CAPABILITIES: ServiceCapabilities = { list: false, detail: false, create: false };

/**
 * Builds a module spec from the registry entry, refusing to declare operations
 * the api would reject. Called by every `spec.ts`, including generated ones, so
 * ui capabilities and the api whitelist cannot drift apart.
 */
export function createServiceSpec(
  service: ServiceDescriptor | string,
  input: ServiceSpecInput = {},
): ServiceSpec {
  const descriptor = typeof service === 'string' ? findService(service) : service;
  if (descriptor === undefined) {
    throw new Error(
      `createServiceSpec: no service is registered with the id "${String(service)}". ` +
        'Add it to the LocalDeck service registry first.',
    );
  }

  const operations = input.operations ?? [];
  const notWhitelisted = operations.filter(
    (operation) => !descriptor.operations.includes(operation),
  );
  if (notWhitelisted.length > 0) {
    throw new Error(
      `createServiceSpec: ${descriptor.id} does not whitelist ${notWhitelisted.join(', ')}. ` +
        `Allowed operations: ${descriptor.operations.join(', ')}.`,
    );
  }

  return {
    descriptor,
    operations: [...operations],
    capabilities: { ...DEFAULT_CAPABILITIES, ...input.capabilities },
  };
}

export interface ServiceModuleProblem {
  /** Path or id the problem was found at, for the console warning. */
  where: string;
  message: string;
}

/**
 * Structural check for modules discovered by the ui's `import.meta.glob`.
 * Returns the problems found; an empty list means the module is usable.
 *
 * The check also enforces `ServiceCapabilities`: a module whose routes mount
 * the standard `list`/`detail`/`create` pages must declare the matching
 * capability, so a generated browser can never advertise `create: false` while
 * mounting a create page.
 */
export function checkServiceModule(where: string, value: unknown): ServiceModuleProblem[] {
  const problems: ServiceModuleProblem[] = [];
  const fail = (message: string): void => {
    problems.push({ where, message });
  };

  if (typeof value !== 'object' || value === null) {
    fail('module does not export an object');
    return problems;
  }
  const module = value as Partial<ServiceModule>;

  if (typeof module.descriptor?.id !== 'string') fail('module.descriptor.id is missing');
  if (typeof module.spec?.descriptor?.id !== 'string') fail('module.spec.descriptor.id is missing');
  if (
    module.descriptor !== undefined &&
    module.spec?.descriptor !== undefined &&
    module.descriptor.id !== module.spec.descriptor.id
  ) {
    fail(
      `module.spec.descriptor.id "${module.spec.descriptor.id}" does not match the descriptor id "${module.descriptor.id}"`,
    );
  }
  if (!Array.isArray(module.routes)) {
    fail('module.routes is missing');
    return problems;
  }

  const capabilities = readCapabilities(module.spec, fail);
  const standardPages = new Set<ServicePageKind>(['list', 'detail', 'create']);

  for (const route of module.routes) {
    if (typeof route?.path !== 'string') {
      fail('a route is missing its path');
      continue;
    }
    if (typeof route.page !== 'string') fail(`route "${route.path}" is missing its page kind`);
    if (typeof route.title !== 'string') fail(`route "${route.path}" is missing its title`);

    const page = route.page as ServicePageKind;
    if (capabilities !== undefined && standardPages.has(page) && capabilities[page] !== true) {
      fail(
        `route "${route.path}" mounts the "${page}" page but module.spec.capabilities.${page} is false`,
      );
    }
  }
  return problems;
}

/** Validates the capability flags; `undefined` when they are unusable. */
function readCapabilities(
  spec: ServiceSpec | undefined,
  fail: (message: string) => void,
): ServiceCapabilities | undefined {
  if (spec === undefined) return undefined;
  const capabilities: unknown = spec.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null) {
    fail('module.spec.capabilities is missing');
    return undefined;
  }
  const record = capabilities as Partial<Record<keyof ServiceCapabilities, unknown>>;
  const flags: ServiceCapabilities = { list: false, detail: false, create: false };
  let valid = true;
  for (const key of ['list', 'detail', 'create'] as const) {
    const value = record[key];
    if (typeof value !== 'boolean') {
      fail(`module.spec.capabilities.${key} must be a boolean`);
      valid = false;
      continue;
    }
    flags[key] = value;
  }
  return valid ? flags : undefined;
}

/** Request body of `POST /api/services/:service/:operation`. */
export interface ServiceOperationRequest {
  /** Operation input, exactly as the AWS SDK expects it. */
  input?: Record<string, unknown>;
}

/** Response body of `POST /api/services/:service/:operation`. */
export interface ServiceOperationResponse<TOutput = unknown> {
  service: string;
  operation: string;
  result: TOutput;
}
