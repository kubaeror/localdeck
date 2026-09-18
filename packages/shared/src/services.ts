import type { EmulatorProviderId, EmulatorServiceState } from './providers/index.js';
import { providerKeysForCanonical } from './providers/index.js';
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
  /** Provider health keys that identify this service, primary key first. */
  healthKeys: readonly string[];
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

/**
 * Health keys that can carry this service's state for a provider, primary key
 * first: the registry id and its declared aliases, plus the provider-specific
 * mappings from `HEALTH_KEY_ALIASES`.
 */
export function serviceHealthKeys(
  service: ServiceDescriptor,
  provider: EmulatorProviderId,
): readonly string[] {
  const base =
    service.healthKeys === undefined ? [service.id] : [service.id, ...service.healthKeys];
  const extra = providerKeysForCanonical(provider, service.id);
  return [...new Set([...base, ...extra])];
}

/**
 * Live status of a registry service, or `undefined` when the provider does not
 * report it — which is how the console knows to grey the entry out.
 */
export function resolveServiceStatus(
  service: ServiceDescriptor,
  services: Readonly<Record<string, EmulatorServiceState>>,
  provider: EmulatorProviderId = 'localstack',
): EmulatorServiceState | undefined {
  for (const key of serviceHealthKeys(service, provider)) {
    const status = services[key];
    if (status !== undefined) return status;
  }
  return undefined;
}

export function isServiceEnabled(
  service: ServiceDescriptor,
  services: Readonly<Record<string, EmulatorServiceState>>,
  provider: EmulatorProviderId = 'localstack',
): boolean {
  return resolveServiceStatus(service, services, provider) === 'enabled';
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

/** How the registry lines up with what the active emulator actually reports. */
export interface RegistryCoverage {
  provider: EmulatorProviderId;
  /** Services in the registry. */
  registered: number;
  /** Registered services the provider reports as enabled. */
  emulated: number;
  /** Registered services the provider reports as disabled (Floci). */
  disabled: number;
  /** Registry ids the provider does not report at all (as reported). */
  notEmulated: readonly string[];
  /** Provider service keys with no registry entry, so they never reach the ui. */
  unregistered: readonly string[];
}

/**
 * Bootstraps the registry against a live health document so the console can
 * show how much of the running emulator it actually covers. The catalogue is a
 * parameter so callers can pass the registry they are actually rendering
 * (bundled vs. served by GET /api/services) instead of the module default.
 */
export function summarizeRegistryCoverage(
  services: Readonly<Record<string, EmulatorServiceState>>,
  catalog: readonly ServiceDescriptor[] = SERVICE_CATALOG,
  provider: EmulatorProviderId = 'localstack',
): RegistryCoverage {
  const claimed = new Set<string>();
  const notEmulated: string[] = [];
  let emulated = 0;
  let disabled = 0;

  for (const service of catalog) {
    const keys = serviceHealthKeys(service, provider);
    for (const key of keys) claimed.add(key);
    const status = resolveServiceStatus(service, services, provider);
    if (status === 'enabled') emulated += 1;
    else if (status === 'disabled') disabled += 1;
    else if (status === undefined) notEmulated.push(service.id);
  }

  const unregistered = Object.keys(services)
    .filter((key) => !claimed.has(key))
    .sort((left, right) => left.localeCompare(right));

  return {
    provider,
    registered: catalog.length,
    emulated,
    disabled,
    notEmulated,
    unregistered,
  };
}
