import type { LocalStackServiceStatus } from './health.js';
import { SERVICE_CATALOG, SERVICE_CATEGORIES } from './catalog/index.js';
import type {
  ServiceBrowserOperations,
  ServiceCategory,
  ServiceDescriptor,
} from './catalog/index.js';

export * from './catalog/index.js';

/**
 * LocalDeck's service registry for the api and the ui.
 *
 * The catalogue itself lives in `./catalog/`, one file per console category,
 * and is re-exported here together with the access helpers both processes use.
 * The api serves it over HTTP and enforces the operation whitelist; the ui
 * renders navigation, search and the generic resource browser from it.
 */

/** Registry shape served by GET /api/services. */
export interface ServiceRegistryResponse {
  services: readonly ServiceDescriptor[];
  categories: readonly ServiceCategorySummary[];
}

/** Shape served by GET /api/services/:serviceId. */
export interface ServiceDetailResponse {
  service: ServiceDescriptor;
  /** LocalStack health keys that identify this service, primary key first. */
  localStackKeys: readonly string[];
}

/**
 * Shape served by GET /api/services/:serviceId/operations: the whitelist the
 * api's dynamic dispatcher enforces, plus the generic-browser binding (listOp
 * with its required params, and the optional describe/delete/tags operations).
 */
export interface ServiceOperationsResponse {
  service: string;
  operations: readonly string[];
  browser?: ServiceBrowserOperations;
}

export interface ServiceCategorySummary {
  id: ServiceCategory;
  displayName: string;
  serviceCount: number;
}

const SERVICE_BY_ID = new Map<string, ServiceDescriptor>(
  SERVICE_CATALOG.map((service) => [service.id, service]),
);

export function findService(id: string): ServiceDescriptor | undefined {
  return SERVICE_BY_ID.get(id);
}

/** LocalStack health keys that identify this service, primary key first. */
export function localStackKeysFor(service: ServiceDescriptor): readonly string[] {
  return service.healthKeys === undefined ? [service.id] : [service.id, ...service.healthKeys];
}

/**
 * Live status of a registry service, or `undefined` when LocalStack does not
 * report it — which is how the console knows to grey the entry out.
 */
export function resolveServiceStatus(
  service: ServiceDescriptor,
  services: Readonly<Record<string, LocalStackServiceStatus>>,
): LocalStackServiceStatus | undefined {
  for (const key of localStackKeysFor(service)) {
    const status = services[key];
    if (status !== undefined) return status;
  }
  return undefined;
}

export function isServiceEmulated(
  service: ServiceDescriptor,
  services: Readonly<Record<string, LocalStackServiceStatus>>,
): boolean {
  return resolveServiceStatus(service, services) !== undefined;
}

/** Flat text a fuzzy matcher can score: name, id, category, summary and ops. */
export function serviceSearchText(service: ServiceDescriptor): string {
  return [
    service.displayName,
    service.id,
    service.category,
    service.summary,
    service.operations.join(' '),
  ].join(' ');
}

export function servicesInCategory(category: ServiceCategory): readonly ServiceDescriptor[] {
  return SERVICE_CATALOG.filter((service) => service.category === category);
}

export function serviceCategories(): readonly ServiceCategorySummary[] {
  return SERVICE_CATEGORIES.map((category) => ({
    id: category,
    displayName: category,
    serviceCount: servicesInCategory(category).length,
  }));
}

/**
 * Every operation the generic browser calls, in list/describe/delete/tags
 * order, de-duplicated. All of them must appear in `service.operations`.
 */
export function browserOperationsFor(service: ServiceDescriptor): readonly string[] {
  const browser = service.browser;
  if (browser === undefined) return [];
  const names = [
    browser.list.operation,
    browser.describe?.operation,
    browser.delete?.operation,
    browser.tags?.operation,
  ];
  return [
    ...new Set(names.filter((name): name is string => typeof name === 'string' && name.length > 0)),
  ];
}

/** How the registry lines up with what LocalStack actually reports. */
export interface RegistryCoverage {
  /** Services in the registry. */
  registered: number;
  /** Registered services LocalStack reports as emulated. */
  emulated: number;
  /** Registry ids LocalStack does not report at all (as reported). */
  notEmulated: readonly string[];
  /** LocalStack service keys with no registry entry, so they never reach the ui. */
  unregistered: readonly string[];
}

/**
 * Bootstraps the registry against a live health document so the console can
 * show how much of the running emulator it actually covers. The catalogue is a
 * parameter so callers can pass the registry they are actually rendering
 * (bundled vs. served by GET /api/services) instead of the module default.
 */
export function summarizeRegistryCoverage(
  services: Readonly<Record<string, LocalStackServiceStatus>>,
  catalog: readonly ServiceDescriptor[] = SERVICE_CATALOG,
): RegistryCoverage {
  const claimed = new Set<string>();
  const notEmulated: string[] = [];
  let emulated = 0;

  for (const service of catalog) {
    const keys = localStackKeysFor(service);
    for (const key of keys) claimed.add(key);
    if (resolveServiceStatus(service, services) === undefined) notEmulated.push(service.id);
    else emulated += 1;
  }

  const unregistered = Object.keys(services)
    .filter((key) => !claimed.has(key))
    .sort((left, right) => left.localeCompare(right));

  return {
    registered: catalog.length,
    emulated,
    notEmulated,
    unregistered,
  };
}
