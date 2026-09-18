import { checkServiceModule, findService, type ServiceDescriptor } from '@localdeck/shared';
import { createGenericBrowserModule } from './generic';
import { createPlaceholderModule } from './placeholderModule';
import type { UiServiceModule } from './types';

/**
 * Service modules are discovered, never registered by hand: every
 * `src/services/<id>/index.ts` is globbed here, so adding a generated module
 * makes the service appear in the sidebar, the global search and the router in
 * the same build.
 *
 * `services/generic/` is the shared fallback browser, not a service module, so
 * the glob excludes it. Modules that fail the structural check are skipped
 * with a console warning instead of taking the whole console down.
 */
const DISCOVERED_MODULES = import.meta.glob<{ default: UiServiceModule }>(
  ['./*/index.ts', '!./generic/index.ts'],
  { eager: true },
);

function discoverModules(): ReadonlyMap<string, UiServiceModule> {
  const modules = new Map<string, UiServiceModule>();

  for (const [path, imported] of Object.entries(DISCOVERED_MODULES).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const candidate = imported.default;
    const folder = path.split('/')[1] ?? path;

    const problems = checkServiceModule(path, candidate);
    if (problems.length > 0) {
      for (const problem of problems) {
        console.warn(`[localdeck] ignoring service module ${problem.where}: ${problem.message}`);
      }
      continue;
    }

    if (candidate.descriptor.id !== folder) {
      console.warn(
        `[localdeck] service module ${path} declares the id "${candidate.descriptor.id}"; ` +
          `the folder should be named "${candidate.descriptor.id}".`,
      );
    }

    modules.set(candidate.descriptor.id, candidate);
  }

  return modules;
}

const MODULES = discoverModules();

/**
 * The module for a service, in console priority order:
 * 1. a dedicated module discovered under `src/services/<id>/` — it wins over
 *    everything else, which is how the hand-written consoles stay in charge;
 * 2. the generated resource browser when the registry binds a listOp;
 * 3. the registry placeholder for `planned` services and unknown page kinds.
 */
export function getServiceModule(serviceId: string): UiServiceModule | undefined {
  const dedicated = MODULES.get(serviceId);
  if (dedicated !== undefined) return dedicated;

  const descriptor = findService(serviceId);
  if (descriptor === undefined) return undefined;
  return createGenericBrowserModule(descriptor) ?? createPlaceholderModule(descriptor);
}

/** Modules with their own folder, for diagnostics and the service health page. */
export function listDiscoveredModules(): readonly UiServiceModule[] {
  return [...MODULES.values()];
}

/**
 * The registry plus every service contributed by a module. Modules win, so a
 * generated module can introduce a service the api registry does not know yet
 * (its operations will be rejected by the dispatcher until the registry has it).
 */
export function mergeServiceCatalog(
  services: readonly ServiceDescriptor[],
): readonly ServiceDescriptor[] {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const module of MODULES.values()) byId.set(module.descriptor.id, module.descriptor);
  return [...byId.values()];
}
