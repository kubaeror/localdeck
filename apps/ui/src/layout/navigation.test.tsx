// @vitest-environment jsdom
import { SERVICE_CATALOG, type LocalStackServiceStatus } from '@localdeck/shared';
import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { describe, expect, it } from 'vitest';
import { buildNavigation, navigationActiveHref, NOT_EMULATED_TOOLTIP } from './navigation';

const STATUSES: Record<string, LocalStackServiceStatus> = {
  s3: 'available',
  lambda: 'available',
  logs: 'available',
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
    const model = buildNavigation({ services: SERVICE_CATALOG, serviceStatuses: STATUSES });

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
    const model = buildNavigation({ services: SERVICE_CATALOG, serviceStatuses: STATUSES });
    const all = links(model.items);
    expect(all[0]).toMatchObject({ text: 'Console Home', href: '/console/home' });
    expect(all.map((link) => link.text)).toEqual(
      expect.arrayContaining(['Service health', 'All services']),
    );
  });

  it('marks services LocalStack does not report and never hides them', () => {
    const model = buildNavigation({ services: SERVICE_CATALOG, serviceStatuses: STATUSES });
    const all = links(model.items);
    const emulated = all.find((link) => link.text === 'S3');
    const missing = all.find((link) => link.text === 'EC2');

    expect(emulated?.info).toBeUndefined();
    expect(missing).toBeDefined();
    expect(missing?.info).toBeDefined();
    expect(NOT_EMULATED_TOOLTIP).toBe('Not emulated locally');
  });

  it('lists recently visited services after Console Home', () => {
    const model = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      recentlyVisited: ['lambda', 's3'],
    });
    const recent = links(sectionItems(model.items, 'Recently visited'));
    expect(recent.map((link) => link.text)).toEqual(['Lambda', 'S3']);
  });

  it('filters the tree with the sidebar filter and reports empty results', () => {
    const filtered = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
      filter: 's3',
    });
    expect(filtered.serviceCount).toBeGreaterThan(0);
    expect(links(filtered.items).map((link) => link.text)).toContain('S3');
    expect(links(filtered.items).map((link) => link.text)).not.toContain('EC2');
    expect(filtered.isEmptyFilter).toBe(false);

    const none = buildNavigation({
      services: SERVICE_CATALOG,
      serviceStatuses: STATUSES,
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
