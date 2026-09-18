import { ANALYTICS_SERVICES } from './analytics.js';
import { COMPUTE_SERVICES } from './compute.js';
import { CONTAINER_SERVICES } from './containers.js';
import { DATABASE_SERVICES } from './database.js';
import { DEVELOPER_TOOLS_SERVICES } from './developer-tools.js';
import { INTEGRATION_SERVICES } from './integration.js';
import { MACHINE_LEARNING_SERVICES } from './machine-learning.js';
import { MANAGEMENT_SERVICES } from './management.js';
import { NETWORKING_SERVICES } from './networking.js';
import { SECURITY_SERVICES } from './security.js';
import { STORAGE_SERVICES } from './storage.js';
import type { ServiceDescriptor } from './types.js';

export * from './types.js';

/**
 * Every service LocalDeck knows about, assembled from the per-category
 * catalogues under `src/catalog/`. `id` values mirror LocalStack's health keys
 * so `/api/health` can be matched against the registry without a lookup table;
 * entries whose LocalStack key differs carry `healthKeys`.
 *
 * The category files use `as const satisfies readonly ServiceDescriptor[]` so
 * `iconKey` values stay literal types; the combined array is annotated as
 * `readonly ServiceDescriptor[]` so consumers see optional fields like
 * `healthKeys` and `browser` on every entry. The literal icon-key union stays
 * available as `ServiceCatalogIconKey`.
 */
const SERVICE_CATALOG_ENTRIES = [
  ...COMPUTE_SERVICES,
  ...CONTAINER_SERVICES,
  ...STORAGE_SERVICES,
  ...DATABASE_SERVICES,
  ...NETWORKING_SERVICES,
  ...SECURITY_SERVICES,
  ...INTEGRATION_SERVICES,
  ...ANALYTICS_SERVICES,
  ...MANAGEMENT_SERVICES,
  ...DEVELOPER_TOOLS_SERVICES,
  ...MACHINE_LEARNING_SERVICES,
] as const satisfies readonly ServiceDescriptor[];

/** Literal union of every `iconKey` in the registry. */
export type ServiceCatalogIconKey = (typeof SERVICE_CATALOG_ENTRIES)[number]['iconKey'];

export const SERVICE_CATALOG: readonly ServiceDescriptor[] = SERVICE_CATALOG_ENTRIES;
