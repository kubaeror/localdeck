import {
  SERVICE_CATEGORIES,
  resolveServiceStatus,
  type EmulatorProviderId,
  type EmulatorServiceState,
  type ServiceCategory,
  type ServiceDescriptor,
} from '@localdeck/shared';
import Badge from '@cloudscape-design/components/badge';
import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { InfoTooltip } from '../components/InfoTooltip';
import { ServiceIcon } from '../components/ServiceIcon';
import {
  disabledShortLabel,
  disabledTooltip,
  notReportedShortLabel,
  notReportedTooltip,
  NOT_INSTALLED_SHORT_LABEL,
  NOT_INSTALLED_TOOLTIP,
  UNVERIFIED_SERVICE_TOOLTIP,
} from '../lib/copy';
import { searchServices } from '../lib/serviceSearch';
import {
  ALL_SERVICES_PATH,
  CONSOLE_HOME_PATH,
  SERVICE_HEALTH_PATH,
  serviceConsolePath,
} from '../services/paths';

const FIXED_NAV_PATHS = [CONSOLE_HOME_PATH, SERVICE_HEALTH_PATH, ALL_SERVICES_PATH];

/**
 * The sidebar link to highlight for a console path: exact for the fixed
 * entries, otherwise the service console that owns the path
 * (`/console/s3/buckets` highlights `/console/s3`).
 */
export function navigationActiveHref(pathname: string): string {
  if (FIXED_NAV_PATHS.includes(pathname)) return pathname;
  const match = /^\/console\/([^/]+)/.exec(pathname);
  const serviceId = match?.[1];
  return serviceId === undefined ? pathname : serviceConsolePath(serviceId);
}

export interface NavigationModel {
  items: readonly SideNavigationProps.Item[];
  /** Service links rendered by the model. */
  serviceCount: number;
  /** Service links the active provider reports as enabled. */
  emulatedCount: number;
  /** True when a filter is applied and nothing matches it. */
  isEmptyFilter: boolean;
}

export interface BuildNavigationOptions {
  services: readonly ServiceDescriptor[];
  serviceStatuses: Readonly<Record<string, EmulatorServiceState>>;
  /** Active emulator, used to resolve provider-specific health keys. */
  provider: EmulatorProviderId;
  /** Display name of the active emulator ("LocalStack", "MiniStack", "Floci"). */
  providerLabel: string;
  /** False for endpoints with no service inventory (generic fallback). */
  hasServiceInventory: boolean;
  /** Sidebar filter text; empty means "show everything". */
  filter?: string;
}

function byDisplayName(left: ServiceDescriptor, right: ServiceDescriptor): number {
  return left.displayName.localeCompare(right.displayName, 'en');
}

interface ServiceBadge {
  label: string;
  tooltip: string;
  color: 'grey' | 'red';
}

function unavailableBadge(
  state: EmulatorServiceState | undefined,
  available: boolean,
  providerLabel: string,
  hasServiceInventory: boolean,
): ServiceBadge | undefined {
  if (!available) {
    return { label: NOT_INSTALLED_SHORT_LABEL, tooltip: NOT_INSTALLED_TOOLTIP, color: 'grey' };
  }
  if (state === 'enabled') return undefined;
  if (state === 'error') {
    return {
      label: 'error',
      tooltip: `${providerLabel} reports this service in an error state. Check the emulator logs.`,
      color: 'red',
    };
  }
  if (state === 'starting') {
    return {
      label: 'starting',
      tooltip: `${providerLabel} is still starting this service.`,
      color: 'grey',
    };
  }
  if (state === 'disabled') {
    return { label: disabledShortLabel(), tooltip: disabledTooltip(providerLabel), color: 'grey' };
  }
  if (!hasServiceInventory) {
    return {
      label: 'unverified',
      tooltip: UNVERIFIED_SERVICE_TOOLTIP,
      color: 'grey',
    };
  }
  return {
    label: notReportedShortLabel(),
    tooltip: notReportedTooltip(providerLabel),
    color: 'grey',
  };
}

function serviceLink(
  service: ServiceDescriptor,
  state: EmulatorServiceState | undefined,
  available: boolean,
  providerLabel: string,
  hasServiceInventory: boolean,
): SideNavigationProps.Link {
  const link: SideNavigationProps.Link = {
    type: 'link',
    text: service.displayName,
    href: serviceConsolePath(service.id),
    icon: <ServiceIcon iconKey={service.iconKey} category={service.category} size="small" />,
  };

  const badge = unavailableBadge(state, available, providerLabel, hasServiceInventory);
  if (badge === undefined) return link;

  return {
    ...link,
    info: (
      <InfoTooltip content={badge.tooltip} className="app-shell__nav-unavailable">
        <Badge color={badge.color}>{badge.label}</Badge>
      </InfoTooltip>
    ),
  };
}

function categorySection(
  category: ServiceCategory,
  services: readonly ServiceDescriptor[],
  link: (service: ServiceDescriptor) => SideNavigationProps.Link,
): SideNavigationProps.Section {
  return {
    type: 'section',
    text: category,
    items: services.map(link),
  };
}

/**
 * Builds the console sidebar: Console Home, then every category from the AWS
 * console with the services LocalDeck knows about. Services the active
 * emulator does not report (or reports as disabled) are greyed out and
 * tooltipped instead of hidden, so the navigation always mirrors the real
 * stack. Recently-visited services live on Console Home, not here: duplicating
 * them produced two links with the same href in one navigation.
 */
export function buildNavigation({
  services,
  serviceStatuses,
  provider,
  providerLabel,
  hasServiceInventory,
  filter = '',
}: BuildNavigationOptions): NavigationModel {
  const stateOf = (service: ServiceDescriptor): EmulatorServiceState | undefined =>
    resolveServiceStatus(service, serviceStatuses, provider);
  // `available` is set by the api registry; the bundled catalogue leaves it
  // undefined, which means "assume the package is installed".
  const isAvailable = (service: ServiceDescriptor): boolean => service.available !== false;
  const link = (service: ServiceDescriptor): SideNavigationProps.Link =>
    serviceLink(
      service,
      stateOf(service),
      isAvailable(service),
      providerLabel,
      hasServiceInventory,
    );

  const query = filter.trim();
  const matched = query.length === 0 ? null : searchServices(query, services, services.length);

  const serviceCount = matched === null ? services.length : matched.length;
  const emulatedCount = (
    matched === null ? services : matched.map((match) => match.service)
  ).filter((service) => stateOf(service) === 'enabled').length;

  const items: SideNavigationProps.Item[] = [];

  if (query.length === 0) {
    items.push({
      type: 'link',
      text: 'Console Home',
      href: CONSOLE_HOME_PATH,
      icon: <ServiceIcon iconKey="console-home" size="small" />,
    });
  }

  const servicesByCategory = new Map<ServiceCategory, ServiceDescriptor[]>(
    SERVICE_CATEGORIES.map((category) => [category, []]),
  );

  if (matched === null) {
    for (const service of services) {
      servicesByCategory.get(service.category)?.push(service);
    }
    for (const entries of servicesByCategory.values()) entries.sort(byDisplayName);
  } else {
    // Relevance order is kept inside each category while filtering.
    for (const match of matched) {
      servicesByCategory.get(match.service.category)?.push(match.service);
    }
  }

  const sections: SideNavigationProps.Item[] = [];
  for (const category of SERVICE_CATEGORIES) {
    const categoryServices = servicesByCategory.get(category) ?? [];
    if (categoryServices.length === 0) continue;
    sections.push(categorySection(category, categoryServices, link));
  }

  if (sections.length > 0) {
    if (items.length > 0) items.push({ type: 'divider' });
    items.push(...sections);
  }

  if (query.length === 0) {
    items.push(
      { type: 'divider' },
      {
        type: 'section',
        text: 'LocalDeck',
        items: [
          {
            type: 'link',
            text: 'Service health',
            href: SERVICE_HEALTH_PATH,
            icon: <ServiceIcon iconKey="service-health" size="small" />,
          },
          {
            type: 'link',
            text: 'All services',
            href: ALL_SERVICES_PATH,
            icon: <ServiceIcon iconKey="all-services" size="small" />,
          },
        ],
      },
    );
  }

  return {
    items,
    serviceCount,
    emulatedCount,
    isEmptyFilter: query.length > 0 && matched !== null && matched.length === 0,
  };
}
