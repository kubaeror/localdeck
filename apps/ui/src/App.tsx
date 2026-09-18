import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ConsoleErrorBoundary } from './components/ConsoleErrorBoundary';
import { FlashbarProvider } from './contexts/FlashbarProvider';
import { GlobalSearchProvider } from './contexts/GlobalSearchProvider';
import { EmulatorStatusProvider } from './contexts/EmulatorStatusProvider';
import { RecentlyVisitedProvider } from './contexts/RecentlyVisitedProvider';
import { ServiceCatalogProvider } from './contexts/ServiceCatalogProvider';
import { AppShell } from './layout/AppShell';
import { AllServicesPage } from './pages/AllServicesPage';
import { ConsoleHomePage } from './pages/ConsoleHomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ServiceHealthPage } from './pages/ServiceHealthPage';
import { ServiceModuleOutlet } from './services/ServiceModuleOutlet';
import { CONSOLE_HOME_PATH } from './services/paths';

/**
 * Console routes. Everything renders inside the console shell; services are
 * mounted from `/console/<serviceId>/…` by their own module.
 */
export function App(): ReactElement {
  return (
    <FlashbarProvider>
      <EmulatorStatusProvider>
        <ServiceCatalogProvider>
          <RecentlyVisitedProvider>
            <GlobalSearchProvider>
              <ConsoleErrorBoundary scope="routes">
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<Navigate to={CONSOLE_HOME_PATH} replace />} />
                    <Route path="console/home" element={<ConsoleHomePage />} />
                    <Route path="console/health" element={<ServiceHealthPage />} />
                    <Route path="console/services" element={<AllServicesPage />} />
                    <Route path="console/:serviceId/*" element={<ServiceModuleOutlet />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </ConsoleErrorBoundary>
            </GlobalSearchProvider>
          </RecentlyVisitedProvider>
        </ServiceCatalogProvider>
      </EmulatorStatusProvider>
    </FlashbarProvider>
  );
}
