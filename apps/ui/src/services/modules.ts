import {
  SERVICE_CATALOG,
  checkServiceModule,
  findService,
  type ServiceDescriptor,
} from '@localdeck/shared';
import { createPlaceholderModule } from './placeholderModule';
import type { UiServiceModule } from './types';

/**
 * Service modules are discovered, never registered by hand: every
 * `src/services/<id>/index.ts` is globbed here, so adding a generated module
 * makes the service appear in the sidebar, the global search and the router in
 * the same build.
 *
 * Discovery is lazy on purpose. The module map is metadata only until a console
 * is opened, so the initial bundle does not carry every page of every service.
 * The sidebar and search read descriptors from the shared catalogue (which is
 * bundled), and `loadServiceModule` dynamically imports the page code the first
 * time a route under `/console/<id>/` renders.
 *
 * `services/generic/` is the shared fallback browser, not a service module, so
 * the glob excludes it. Modules that fail the structural check are skipped
 * with a console warning instead of taking the whole console down.
 */
const MODULE_LOADERS = import.meta.glob<{ default: UiServiceModule }>([
  './*/index.ts',
  '!./generic/index.ts',
]);

/** Ids of the folders that ship their own console, e.g. `s3`, `ec2`. */
const DEDICATED_MODULE_IDS: readonly string[] = Object.keys(MODULE_LOADERS)
  .map((path) => path.split('/')[1] ?? '')
  .filter((id) => id.length > 0)
  .sort();

/** Loaded modules and generated fallbacks, keyed by service id. */
const loadedModules = new Map<string, UiServiceModule>();

function validateModule(
  path: string,
  folder: string,
  candidate: UiServiceModule,
): UiServiceModule | undefined {
  const problems = checkServiceModule(path, candidate);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.warn(`[localdeck] ignoring service module ${problem.where}: ${problem.message}`);
    }
    return undefined;
  }

  if (candidate.descriptor.id !== folder) {
    console.warn(
      `[localdeck] service module ${path} declares the id "${candidate.descriptor.id}"; ` +
        `the folder should be named "${candidate.descriptor.id}".`,
    );
  }

  return candidate;
}

/**
 * The module for a service, loaded on demand:
 * 1. a dedicated module under `src/services/<id>/` — it wins over everything
 *    else, which is how the hand-written consoles stay in charge;
 * 2. the generated resource browser when the registry binds a listOp;
 * 3. the registry placeholder for `planned` services and unknown page kinds.
 *
 * Results are cached, so navigating back to a console never re-imports it.
 */
export async function loadServiceModule(serviceId: string): Promise<UiServiceModule | undefined> {
  const cached = loadedModules.get(serviceId);
  if (cached !== undefined) return cached;

  const path = `./${serviceId}/index.ts`;
  const loader = MODULE_LOADERS[path];
  if (loader !== undefined) {
    try {
      const imported = await loader();
      const module = validateModule(path, serviceId, imported.default);
      if (module !== undefined) {
        loadedModules.set(serviceId, module);
        return module;
      }
    } catch (error) {
      console.warn(`[localdeck] failed to load the service module for "${serviceId}":`, error);
    }
  }

  const descriptor = findService(serviceId);
  if (descriptor === undefined) return undefined;

  // The generated browser is itself split out of the initial bundle: only
  // services without a dedicated console need it.
  const { createGenericBrowserModule } = await import('./generic');
  const fallback = createGenericBrowserModule(descriptor) ?? createPlaceholderModule(descriptor);
  loadedModules.set(serviceId, fallback);
  return fallback;
}

/** Modules with their own folder, for diagnostics and the service health page. */
export function listDiscoveredModuleIds(): readonly string[] {
  return DEDICATED_MODULE_IDS;
}

/**
 * The registry plus every service contributed by a dedicated module. Modules
 * win over the api registry, so a ui build that knows a console the running api
 * does not still keeps it navigable.
 */
export function mergeServiceCatalog(
  services: readonly ServiceDescriptor[],
): readonly ServiceDescriptor[] {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const id of DEDICATED_MODULE_IDS) {
    if (byId.has(id)) continue;
    const descriptor = SERVICE_CATALOG.find((service) => service.id === id);
    if (descriptor !== undefined) byId.set(id, descriptor);
  }
  return [...byId.values()];
}
