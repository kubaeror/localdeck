import { useParams, Route, Routes } from 'react-router-dom';
import { useEffect, useState, type ReactElement } from 'react';
import { Box, Spinner } from '@cloudscape-design/components';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ServicePlaceholderPage } from '../pages/ServicePlaceholderPage';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';
import { loadServiceModule } from './modules';
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

type ModuleState =
  { status: 'loading' } | { status: 'ready'; module: UiServiceModule } | { status: 'missing' };

interface LazyServiceModuleProps {
  serviceId: string;
}

/**
 * Loads one console on demand. The component is keyed by service id, so
 * navigating to another service starts from a fresh loading state without a
 * state update inside the effect body.
 */
function LazyServiceModule({ serviceId }: LazyServiceModuleProps): ReactElement {
  const [state, setState] = useState<ModuleState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void loadServiceModule(serviceId).then((module) => {
      if (cancelled) return;
      setState(module === undefined ? { status: 'missing' } : { status: 'ready', module });
    });

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  if (state.status === 'loading') {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  if (state.status === 'missing') return <NotFoundPage />;

  const module = state.module;
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

/**
 * Mounts the routes that belong to `/console/:serviceId/*`. Unknown service
 * ids fall through to the 404 page instead of rendering an empty console.
 *
 * The module (and with it the page code of one console) is imported on demand,
 * so the initial bundle only carries the shell. A short spinner covers the
 * dynamic import; navigating between consoles is instant once loaded.
 */
export function ServiceModuleOutlet(): ReactElement {
  const { serviceId = '' } = useParams();

  return <LazyServiceModule key={serviceId} serviceId={serviceId} />;
}
