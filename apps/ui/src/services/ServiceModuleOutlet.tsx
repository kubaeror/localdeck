import { useParams, Route, Routes } from 'react-router-dom';
import { useEffect, type ReactElement } from 'react';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ServicePlaceholderPage } from '../pages/ServicePlaceholderPage';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';
import { getServiceModule } from './modules';
import type { ServicePageProps, UiServiceModule } from './types';
import type { ServicePageRoute } from '@localdeck/shared';

interface ServiceRoutePageProps {
  module: UiServiceModule;
  route: ServicePageRoute;
}

/** One module route: the module's page, or the placeholder for that service. */
function ServiceRoutePage({ module, route }: ServiceRoutePageProps): ReactElement {
  const { record } = useRecentlyVisited();
  const serviceId = module.descriptor.id;

  // Every service console counts as a visit for Console Home.
  useEffect(() => {
    record(serviceId);
  }, [record, serviceId]);

  const Page = module.pages[route.page];
  if (Page === undefined) {
    return <ServicePlaceholderPage descriptor={module.descriptor} routeTitle={route.title} />;
  }

  const pageProps: ServicePageProps = { descriptor: module.descriptor };
  return <Page {...pageProps} />;
}

/**
 * Mounts the routes that belong to `/console/:serviceId/*`. Unknown service
 * ids fall through to the 404 page instead of rendering an empty console.
 */
export function ServiceModuleOutlet(): ReactElement {
  const { serviceId = '' } = useParams();
  const module = getServiceModule(serviceId);

  if (module === undefined) return <NotFoundPage />;

  return (
    <Routes>
      {module.routes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={<ServiceRoutePage module={module} route={route} />}
        />
      ))}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
