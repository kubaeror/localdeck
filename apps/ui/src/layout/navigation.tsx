import {
  SERVICE_CATEGORIES,
  findService,
  isServiceEmulated,
  type LocalStackServiceStatus,
  type ServiceCategory,
  type ServiceDescriptor,
} from '@localdeck/shared';
import Badge from '@cloudscape-design/components/badge';
import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { InfoTooltip } from '../components/InfoTooltip';
import { ServiceIcon } from '../components/ServiceIcon';
import { searchServices } from '../lib/serviceSearch';
import {
  ALL_SERVICES_PATH,
  CONSOLE_HOME_PATH,
  SERVICE_HEALTH_PATH,
  serviceConsolePath,
} from '../services/paths';

/** Exact wording required for services the emulator does not report. */
export const NOT_EMULATED_TOOLTIP = 'Not emulated locally';

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

const RECENTLY_VISITED_IN_NAV = 5;

export interface NavigationModel {
  items: readonly SideNavigationProps.Item[];
  /** Service links rendered by the model. */
  serviceCount: number;
  /** Service links that LocalStack reports as emulated. */
  emulatedCount: number;
  /** True when a filter is applied and nothing matches it. */
  isEmptyFilter: boolean;
}

export interface BuildNavigationOptions {
  services: readonly ServiceDescriptor[];
  serviceStatuses: Readonly<Record<string, LocalStackServiceStatus>>;
  /** Sidebar filter text; empty means "show everything". */
  filter?: string;
  /** Service ids, most recent first. */
  recentlyVisited?: readonly string[];
}

function byDisplayName(left: ServiceDescriptor, right: ServiceDescriptor): number {
  return left.displayName.localeCompare(right.displayName, 'en');
}

function serviceLink(service: ServiceDescriptor, emulated: boolean): SideNavigationProps.Link {
  const link: SideNavigationProps.Link = {
    type: 'link',
    text: service.displayName,
    href: serviceConsolePath(service.id),
    icon: <ServiceIcon iconKey={service.iconKey} category={service.category} size="small" />,
  };

  if (emulated) return link;

  return {
    ...link,
    info: (
      <InfoTooltip content={NOT_EMULATED_TOOLTIP} className="app-shell__nav-unavailable">
        <Badge color="grey">not emulated</Badge>
      </InfoTooltip>
    ),
  };
}

function categorySection(
  category: ServiceCategory,
  services: readonly ServiceDescriptor[],
  isEmulated: (service: ServiceDescriptor) => boolean,
): SideNavigationProps.Section {
  return {
    type: 'section',
    text: category,
    items: services.map((service) => serviceLink(service, isEmulated(service))),
  };
}

/**
 * Builds the console sidebar: Console Home, the recently visited trail, then
 * every category from the AWS console with the services LocalDeck knows about.
 * Services that `/api/health` does not report are greyed out and tooltipped
 * instead of hidden, so the navigation always mirrors the real stack.
 */
export function buildNavigation({
  services,
  serviceStatuses,
  filter = '',
  recentlyVisited = [],
}: BuildNavigationOptions): NavigationModel {
  const isEmulated = (service: ServiceDescriptor): boolean =>
    isServiceEmulated(service, serviceStatuses);

  const query = filter.trim();
  const matched = query.length === 0 ? null : searchServices(query, services, services.length);

  const serviceCount = matched === null ? services.length : matched.length;
  const emulatedCount = (
    matched === null ? services : matched.map((match) => match.service)
  ).filter(isEmulated).length;

  const items: SideNavigationProps.Item[] = [];

  if (query.length === 0) {
    items.push({
      type: 'link',
      text: 'Console Home',
      href: CONSOLE_HOME_PATH,
      icon: <ServiceIcon iconKey="console-home" size="small" />,
    });
  }

  if (matched === null && recentlyVisited.length > 0) {
    const recentServices = recentlyVisited
      .map((id) => findService(id))
      .filter((service): service is ServiceDescriptor => service !== undefined)
      .slice(0, RECENTLY_VISITED_IN_NAV);
    if (recentServices.length > 0) {
      items.push({
        type: 'section',
        text: 'Recently visited',
        items: recentServices.map((service) => serviceLink(service, isEmulated(service))),
      });
    }
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
    sections.push(categorySection(category, categoryServices, isEmulated));
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
