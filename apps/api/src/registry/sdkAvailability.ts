import { createRequire } from 'node:module';
import type { ServiceDescriptor } from '@localdeck/shared';

/**
 * Whether a registry descriptor can actually be proxied by this api process.
 *
 * Availability is derived from package resolution (`require.resolve`), never
 * from importing the SDK: resolving is cheap, synchronous and side-effect free,
 * while importing every `@aws-sdk/client-*` would construct no clients but
 * still execute 100+ module graphs at boot. Results are cached per package.
 */

const require = createRequire(import.meta.url);
const packageAvailability = new Map<string, boolean>();

/** True when `sdkPackage` resolves from the api's node_modules. */
export function isSdkPackageInstalled(sdkPackage: string): boolean {
  const cached = packageAvailability.get(sdkPackage);
  if (cached !== undefined) return cached;

  let installed: boolean;
  try {
    require.resolve(sdkPackage);
    installed = true;
  } catch {
    installed = false;
  }
  packageAvailability.set(sdkPackage, installed);
  return installed;
}

/**
 * True when the descriptor's operations can be dispatched. `planned` services
 * are never available: they are placeholders by contract, even when their SDK
 * package happens to be installed for another module.
 */
export function isServiceAvailable(service: ServiceDescriptor): boolean {
  if (service.parityLevel === 'planned') return false;
  return isSdkPackageInstalled(service.sdkPackage);
}

/** The descriptor as served over HTTP, with the runtime availability signal. */
export function withAvailability(service: ServiceDescriptor): ServiceDescriptor {
  return { ...service, available: isServiceAvailable(service) };
}

/** Test hook: forget the resolution cache. */
export function resetSdkAvailabilityCache(): void {
  packageAvailability.clear();
}
