// @vitest-environment jsdom
import { SERVICE_CATALOG, type EmulatorServiceState } from '@localdeck/shared';
import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { describe, expect, it } from 'vitest';
import { buildNavigation, navigationActiveHref } from './navigation';

const STATUSES: Record<string, EmulatorServiceState> = {
  s3: 'enabled',
  lambda: 'enabled',
  logs: 'enabled',
  ecs: 'disabled',
};

const DEFAULTS = {
  provider: 'localstack' as const,
  providerLabel: 'LocalStack',
  hasServiceInventory: true,
};

function links(items: readonly SideNavigationProps.Item[]): readonly SideNavigationProps.Link[] {
  return items.flatMap((item) => {
    if (item.type === 'link') return [item];
    if (item.type === 'section' || item.type === 'section-group') {
      return links(item.items as readonly SideNavigationProps.Item[]);
    }
    if (item.type === 'link-group' || item.type === 'expandable-link-group') {
      return [
        { type: 'link', text: item.text, href: item.href },
        ...links(item.items as readonly SideNavigationProps.Item[]),
      ];
    }
    return [];
  });
}

function sectionItems(
  items: readonly SideNavigationProps.Item[],
  text: string,
): readonly SideNavigationProps.Item[] {
  const section = items.find(
    (item): item is SideNavigationProps.Section => item.type === 'section' && item.text === text,
  );
  return section?.items ?? [];
}

describe('buildNavigation', () => {
  it('groups the registry into console categories', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
    });

    expect(model.serviceCount).toBe(SERVICE_CATALOG.length);
    expect(model.emulatedCount).toBe(3);
    expect(links(sectionItems(model.items, 'Storage'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'S3', href: '/console/s3' })]),
    );
    expect(links(sectionItems(model.items, 'Management & Governance'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'CloudWatch Logs', href: '/console/logs' }),
      ]),
    );
  });

  it('starts with Console Home and ends with the LocalDeck entries', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
    });
    const all = links(model.items);
    expect(all[0]).toMatchObject({ text: 'Console Home', href: '/console/home' });
    expect(all.map((link) => link.text)).toEqual(
      expect.arrayContaining(['Service health', 'All services']),
    );
  });

  it('marks services the provider does not report and never hides them', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
    });
    const all = links(model.items);
    const reported = all.find((link) => link.text === 'S3');
    const missing = all.find((link) => link.text === 'EC2');

    expect(reported?.info).toBeUndefined();
    expect(missing).toBeDefined();
    expect(missing?.info).toBeDefined();
    expect(JSON.stringify(missing?.info)).toContain('not reported');
  });

  it('marks services the provider knows but has disabled', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
    });
    const ecs = links(model.items).find((link) => link.text === 'ECS');
    expect(JSON.stringify(ecs?.info)).toContain('disabled');
  });

  it('marks services unverified when the endpoint has no service inventory', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: {},
      provider: 'generic',
      providerLabel: 'AWS-compatible endpoint',
      hasServiceInventory: false,
    });
    const ec2 = links(model.items).find((link) => link.text === 'EC2');
    expect(JSON.stringify(ec2?.info)).toContain('unverified');
  });

  it('marks services the api cannot proxy because the SDK package is missing', () => {
    const services = SERVICE_CATALOG.map((service) =>
      service.id === 's3' ? { ...service, available: false } : service,
    );
    const model = buildNavigation({ services, serviceStatuses: STATUSES, ...DEFAULTS });
    const s3 = links(model.items).find((link) => link.text === 'S3');

    // Enabled, but the api has no @aws-sdk/client-s3 installed.
    expect(s3?.info).toBeDefined();
    const rendered = JSON.stringify(s3?.info);
    expect(rendered).toContain('not installed');
  });

  it('renders each service link exactly once (no duplicate hrefs)', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
    });
    const hrefs = links(model.items).map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('filters the tree with the sidebar filter and reports empty results', () => {
    const filtered = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
      filter: 's3',
    });
    expect(filtered.serviceCount).toBeGreaterThan(0);
    expect(links(filtered.items).map((link) => link.text)).toContain('S3');
    expect(links(filtered.items).map((link) => link.text)).not.toContain('EC2');
    expect(filtered.isEmptyFilter).toBe(false);

    const none = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      ...DEFAULTS,
      // No service text can contain this, so the filter matches nothing.
      filter: '$$$',
    });
    expect(none.isEmptyFilter).toBe(true);
    expect(none.items).toHaveLength(0);
  });

  it('highlights the service console that owns a deep path', () => {
    expect(navigationActiveHref('/console/home')).toBe('/console/home');
    expect(navigationActiveHref('/console/health')).toBe('/console/health');
    expect(navigationActiveHref('/console/s3')).toBe('/console/s3');
    expect(navigationActiveHref('/console/s3/buckets/my-bucket')).toBe('/console/s3');
    expect(navigationActiveHref('/nope')).toBe('/nope');
  });
});
