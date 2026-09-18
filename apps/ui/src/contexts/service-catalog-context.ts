import type { ServiceDescriptor } from '@localdeck/shared';
import { createContext } from 'react';

/** Where the rendered registry came from. */
export type ServiceCatalogSource = 'bundled' | 'api';

export interface ServiceCatalogContextValue {
  services: readonly ServiceDescriptor[];
  source: ServiceCatalogSource;
}

export const ServiceCatalogContext = createContext<ServiceCatalogContextValue | null>(null);
