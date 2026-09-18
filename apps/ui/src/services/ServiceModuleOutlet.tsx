import { useParams, Route, Routes } from 'react-router-dom';
import { useEffect, useState, type ReactElement } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
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
  | { status: 'loading' }
  | { status: 'ready'; module: UiServiceModule }
  | { status: 'missing' }
  | { status: 'error'; message: string };

interface LazyServiceModuleProps {
  serviceId: string;
}

/** Explains a dynamic-import failure without dumping a chunk error at the user. */
function moduleLoadErrorMessage(serviceId: string, error: unknown): string {
  const detail = error instanceof Error && error.message.length > 0 ? ` ${error.message}` : '';
  return (
    `The console code for “${serviceId}” could not be loaded. ` +
    `Check that the ui server is reachable and retry.${detail}`
  );
}

/**
 * Loads one console on demand. The component is keyed by service id, so
 * navigating to another service starts from a fresh loading state without a
 * state update inside the effect body. Both the dedicated-module import and
 * the generic-browser import reject through `loadServiceModule`, so a chunk
 * that fails to load lands in the retryable error state instead of a spinner
 * that never resolves.
 */
function LazyServiceModule({ serviceId }: LazyServiceModuleProps): ReactElement {
  const [state, setState] = useState<ModuleState>({ status: 'loading' });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void loadServiceModule(serviceId)
      .then((module) => {
        if (cancelled) return;
        setState(module === undefined ? { status: 'missing' } : { status: 'ready', module });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', message: moduleLoadErrorMessage(serviceId, error) });
      });

    return () => {
      cancelled = true;
    };
  }, [serviceId, retryToken]);

  if (state.status === 'loading') {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
      </Box>
    );
  }

  if (state.status === 'error') {
    return (
      <Alert
        type="error"
        header="Could not load this service console"
        action={
          <Button
            onClick={() => {
              setState({ status: 'loading' });
              setRetryToken((value) => value + 1);
            }}
          >
            Retry
          </Button>
        }
      >
        {state.message}
      </Alert>
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
