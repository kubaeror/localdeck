import type { LocalStackServiceStatus } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceAvailabilityTable } from './ServiceAvailabilityTable';

function serviceMap(entries: readonly (readonly [string, LocalStackServiceStatus])[]) {
  return Object.fromEntries(entries) as Record<string, LocalStackServiceStatus>;
}

function rowNames(): readonly string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent ?? '');
}

describe('ServiceAvailabilityTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the id tie-break in the same direction as the sorted field', () => {
    render(
      <ServiceAvailabilityTable
        services={serviceMap([
          ['alpha', 'available'],
          ['beta', 'available'],
        ])}
        onRefresh={() => undefined}
      />,
    );

    expect(rowNames()).toEqual(['alpha', 'beta']);

    const statusHeader = screen.getByRole('button', { name: /LocalStack status/ });
    fireEvent.click(statusHeader);
    // Ascending: equal statuses fall back to ascending ids.
    expect(rowNames()).toEqual(['alpha', 'beta']);

    fireEvent.click(statusHeader);
    // Descending: the tie-break follows, so the ids descend too.
    expect(rowNames()).toEqual(['beta', 'alpha']);
  });

  it('clamps the page index when the service list shrinks', () => {
    const many = Object.fromEntries(
      Array.from({ length: 25 }, (_value, index) => [
        `svc-${String(index).padStart(2, '0')}`,
        'available' as LocalStackServiceStatus,
      ]),
    );
    const onRefresh = vi.fn();
    const { rerender } = render(<ServiceAvailabilityTable services={many} onRefresh={onRefresh} />);

    // Page 2 of 25 rows shows rows 21+.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(rowNames()[0]).toBe('svc-20');

    // A health poll removes most services; the table must fall back to page 1
    // instead of rendering an empty page.
    rerender(
      <ServiceAvailabilityTable
        services={serviceMap([
          ['svc-00', 'available'],
          ['svc-01', 'available'],
        ])}
        onRefresh={onRefresh}
      />,
    );

    expect(rowNames()).toEqual(['svc-00', 'svc-01']);
  });
});
