import type { ServiceDescriptor, ServiceModule, ServicePageId } from '@localdeck/shared';
import type { ComponentType } from 'react';

/** Props every service page receives; pages may ignore them. */
export interface ServicePageProps {
  descriptor: ServiceDescriptor;
}

/**
 * A service module as the ui consumes it: the shared module contract plus the
 * component for each route's page kind. `index.ts` in a service folder default-
 * exports this shape and the shell discovers it automatically.
 */
export interface UiServiceModule extends ServiceModule {
  pages: Partial<Record<ServicePageId, ComponentType<ServicePageProps>>>;
}
