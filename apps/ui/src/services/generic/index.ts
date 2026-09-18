import {
  browserOperationsFor,
  createServiceSpec,
  type ServiceDescriptor,
  type ServicePageRoute,
  type ServiceSpec,
} from '@localdeck/shared';
import type { UiServiceModule } from '../types';
import { GenericResourceCreate } from './pages/ResourceCreate';
import { GenericResourceDetail } from './pages/ResourceDetail';
import { GenericResourceList } from './pages/ResourceList';

/**
 * The generated resource browser, used for every registry service that has a
 * browser binding but no dedicated module under `src/services/<id>/`.
 * Dedicated modules always win: `getServiceModule` only falls back here.
 */

/** Routes every generated module mounts; the create surface is conditional. */
function genericRoutes(spec: ServiceSpec): readonly ServicePageRoute[] {
  const routes: ServicePageRoute[] = [{ path: '', title: 'Resources', page: 'list' }];
  if (spec.capabilities.create) {
    routes.push({ path: 'create', title: 'Create', page: 'create' });
  }
  routes.push({ path: 'resources/:resourceId', title: 'Resource details', page: 'detail' });
  return routes;
}

/** Builds the browser module for one descriptor, or `undefined` without a spec. */
export function createGenericBrowserModule(
  descriptor: ServiceDescriptor,
): UiServiceModule | undefined {
  if (descriptor.browser === undefined) return undefined;

  const spec = createServiceSpec(descriptor, {
    operations: browserOperationsFor(descriptor),
    // The generated "create" page is a CLI hand-off, not a form, but it is a
    // real create surface: declaring `false` while mounting it contradicted
    // the routes. Keep the declaration and the routes in one place.
    capabilities: { list: true, detail: true, create: true },
  });

  return {
    descriptor,
    spec,
    routes: genericRoutes(spec),
    pages: {
      list: GenericResourceList,
      create: GenericResourceCreate,
      detail: GenericResourceDetail,
    },
  };
}
