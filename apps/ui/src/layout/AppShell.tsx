import AppLayout from '@cloudscape-design/components/app-layout';
import Box from '@cloudscape-design/components/box';
import Flashbar from '@cloudscape-design/components/flashbar';
import Input from '@cloudscape-design/components/input';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { colorTextStatusInactive } from '@cloudscape-design/design-tokens';
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FLASHBAR_I18N } from '../contexts/flashbar-context';
import { useFlashbar } from '../hooks/useFlashbar';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { AppFooter } from './AppFooter';
import { ConsoleHelpModal } from './ConsoleHelpModal';
import { ConsoleTopNavigation } from './ConsoleTopNavigation';
import { buildNavigation, navigationActiveHref } from './navigation';

const NAVIGATION_OPEN_STORAGE_KEY = 'localdeck.navigation.open';

function readNavigationOpen(): boolean {
  try {
    return window.localStorage.getItem(NAVIGATION_OPEN_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Console chrome: top navigation, the registry-driven side navigation, the
 * app-wide flashbar and the footer. Pages render inside the content outlet and
 * only own their own header, breadcrumbs and body.
 */
export function AppShell(): ReactElement {
  const [isNavigationOpen, setIsNavigationOpen] = useState(readNavigationOpen);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [filter, setFilter] = useState('');
  // Typing stays responsive while the (comparatively expensive) fuzzy match
  // and the ~150 navigation elements rebuild on the deferred value.
  const deferredFilter = useDeferredValue(filter);

  const location = useLocation();
  const navigate = useNavigate();
  const status = useEmulatorStatus();
  const catalog = useServiceCatalog();
  const flashbar = useFlashbar();

  const serviceStatuses = useMemo(() => status.health?.emulator.services ?? {}, [status.health]);
  const provider = status.health?.provider.provider ?? 'generic';
  const providerLabel =
    status.health?.provider.providerLabel ??
    status.config?.emulator.providerLabel ??
    'the emulator';
  const hasServiceInventory = status.health?.emulator.hasServiceInventory ?? false;

  const navigation = useMemo(
    () =>
      buildNavigation({
        services: catalog.services,
        serviceStatuses,
        provider,
        providerLabel,
        hasServiceInventory,
        filter: deferredFilter,
      }),
    [
      catalog.services,
      deferredFilter,
      hasServiceInventory,
      provider,
      providerLabel,
      serviceStatuses,
    ],
  );

  const openHelp = useCallback(() => {
    setIsHelpOpen(true);
  }, []);

  const activeHref = navigationActiveHref(location.pathname);

  return (
    <div className="app-shell">
      <div id="top-navigation">
        <ConsoleTopNavigation onOpenHelp={openHelp} />
      </div>
      <div className="app-shell__main">
        <AppLayout
          contentType="default"
          headerSelector="#top-navigation"
          navigationOpen={isNavigationOpen}
          onNavigationChange={({ detail }) => {
            setIsNavigationOpen(detail.open);
            try {
              window.localStorage.setItem(NAVIGATION_OPEN_STORAGE_KEY, String(detail.open));
            } catch {
              // Preference persistence is best effort.
            }
          }}
          navigation={
            <div
              className="app-shell__nav"
              style={{ '--localdeck-nav-muted': colorTextStatusInactive } as CSSProperties}
            >
              <SpaceBetween size="xs">
                <Input
                  type="search"
                  value={filter}
                  ariaLabel="Filter services"
                  placeholder="Filter services"
                  onChange={(event) => {
                    setFilter(event.detail.value);
                  }}
                />
                <SideNavigation
                  activeHref={activeHref}
                  items={navigation.items}
                  onFollow={(event) => {
                    if (event.detail.external === true) return;
                    event.preventDefault();
                    setFilter('');
                    navigate(event.detail.href);
                  }}
                />
                {navigation.isEmptyFilter ? (
                  <Box color="text-body-secondary" padding={{ horizontal: 's' }}>
                    No service matches the sidebar filter.
                  </Box>
                ) : (
                  <Box variant="small" color="text-body-secondary" padding={{ horizontal: 's' }}>
                    {navigation.emulatedCount} of {navigation.serviceCount} services reported by{' '}
                    {providerLabel}
                  </Box>
                )}
              </SpaceBetween>
            </div>
          }
          notifications={
            flashbar.items.length === 0 ? undefined : (
              <Flashbar items={flashbar.items} i18nStrings={FLASHBAR_I18N} />
            )
          }
          toolsHide
          content={<Outlet />}
        />
      </div>
      <AppFooter />
      <ConsoleHelpModal
        visible={isHelpOpen}
        onDismiss={() => {
          setIsHelpOpen(false);
        }}
      />
    </div>
  );
}
