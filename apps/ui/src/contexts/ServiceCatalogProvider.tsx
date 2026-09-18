import { SERVICE_CATALOG, type ServiceDescriptor } from '@localdeck/shared';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { getServices } from '../lib/apiClient';
import { mergeServiceCatalog } from '../services/modules';
import {
  ServiceCatalogContext,
  type ServiceCatalogSource,
  type ServiceCatalogContextValue,
} from './service-catalog-context';

/**
 * The service registry the console renders (sidebar, search, pages).
 *
 * The catalogue ships with the bundle so the shell renders instantly and works
 * even when the api is down; `GET /api/services` is then used to confirm it, so
 * a ui build that is older than its api still shows exactly what the api can
 * proxy. Modules discovered under `src/services/` are merged on top, which is
 * what makes a generated module appear in the sidebar with no extra wiring.
 */
export function ServiceCatalogProvider({ children }: { children: ReactNode }): ReactElement {
  const [registry, setRegistry] = useState<readonly ServiceDescriptor[]>(() => SERVICE_CATALOG);
  const [source, setSource] = useState<ServiceCatalogSource>('bundled');

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await getServices(controller.signal);
        if (controller.signal.aborted || response.services.length === 0) return;
        setRegistry(response.services);
        setSource('api');
      } catch {
        // The bundled registry stays in place: the api being unreachable must
        // not empty the navigation.
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const services = useMemo(() => mergeServiceCatalog(registry), [registry]);

  const value = useMemo<ServiceCatalogContextValue>(
    () => ({ services, source }),
    [services, source],
  );

  return <ServiceCatalogContext.Provider value={value}>{children}</ServiceCatalogContext.Provider>;
}
