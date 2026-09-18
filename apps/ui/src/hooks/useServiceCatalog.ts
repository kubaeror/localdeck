import { useContext } from 'react';
import {
  ServiceCatalogContext,
  type ServiceCatalogContextValue,
} from '../contexts/service-catalog-context';

/** The service registry as served by the LocalDeck api (bundled fallback). */
export function useServiceCatalog(): ServiceCatalogContextValue {
  const value = useContext(ServiceCatalogContext);
  if (value === null) {
    throw new Error('useServiceCatalog must be used inside <ServiceCatalogProvider>.');
  }
  return value;
}
