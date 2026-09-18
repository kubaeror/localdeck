import {
  browserOperationsFor,
  createServiceSpec,
  type ServiceDescriptor,
  type ServicePageRoute,
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

const GENERIC_ROUTES: readonly ServicePageRoute[] = [
  { path: '', title: 'Resources', page: 'list' },
  { path: 'create', title: 'Create', page: 'create' },
  { path: 'resources/:resourceId', title: 'Resource details', page: 'detail' },
];

/** Builds the browser module for one descriptor, or `undefined` without a spec. */
export function createGenericBrowserModule(
  descriptor: ServiceDescriptor,
): UiServiceModule | undefined {
  if (descriptor.browser === undefined) return undefined;

  return {
    descriptor,
    spec: createServiceSpec(descriptor, {
      operations: browserOperationsFor(descriptor),
      capabilities: { list: true, detail: true, create: false },
    }),
    routes: GENERIC_ROUTES,
    pages: {
      list: GenericResourceList,
      create: GenericResourceCreate,
      detail: GenericResourceDetail,
    },
  };
}
