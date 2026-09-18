import { createServiceSpec, findService, type ServiceDescriptor } from '@localdeck/shared';
import type { UiServiceModule } from './types';

/**
 * Placeholder module used for registry services that do not have their own
 * `services/<id>/` folder yet (and for route kinds a module did not implement).
 * It keeps every entry navigable and explains the parity level instead of
 * pretending to have data.
 */
export function createPlaceholderModule(descriptor: ServiceDescriptor): UiServiceModule {
  return {
    descriptor,
    spec: createServiceSpec(descriptor),
    routes: [{ path: '', title: 'Overview', page: 'list' }],
    // No pages: the shell renders ServicePlaceholderPage for missing page kinds.
    pages: {},
  };
}

export function createPlaceholderModuleForId(serviceId: string): UiServiceModule | undefined {
  const descriptor = findService(serviceId);
  return descriptor === undefined ? undefined : createPlaceholderModule(descriptor);
}
