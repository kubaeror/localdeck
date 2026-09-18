import type { EmulatorServiceState } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceAvailabilityTable } from './ServiceAvailabilityTable';

function serviceMap(entries: readonly (readonly [string, EmulatorServiceState])[]) {
  return Object.fromEntries(entries) as Record<string, EmulatorServiceState>;
}

function rowNames(): readonly string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent ?? '');
}

function renderTable(
  services: Readonly<Record<string, EmulatorServiceState>>,
  props: Partial<Parameters<typeof ServiceAvailabilityTable>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <ServiceAvailabilityTable
      services={services}
      providerLabel="LocalStack"
      onRefresh={() => undefined}
      {...props}
    />,
  );
}

describe('ServiceAvailabilityTable', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the id tie-break in the same direction as the sorted field', () => {
    renderTable(
      serviceMap([
        ['alpha', 'enabled'],
        ['beta', 'enabled'],
      ]),
    );

    expect(rowNames()).toEqual(['alpha', 'beta']);

    const statusHeader = screen.getByRole('button', { name: /Provider status/ });
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
        'enabled' as EmulatorServiceState,
      ]),
    );
    const onRefresh = vi.fn();
    const { rerender } = renderTable(many, { onRefresh });

    // Page 2 of 25 rows shows rows 21+.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(rowNames()[0]).toBe('svc-20');

    // A health poll removes most services; the table must fall back to page 1
    // instead of rendering an empty page.
    rerender(
      <ServiceAvailabilityTable
        services={serviceMap([
          ['svc-00', 'enabled'],
          ['svc-01', 'enabled'],
        ])}
        providerLabel="LocalStack"
        onRefresh={onRefresh}
      />,
    );

    expect(rowNames()).toEqual(['svc-00', 'svc-01']);
  });

  it('shows a checking state while the first health probe runs', () => {
    renderTable({}, { loading: true });
    expect(screen.getByText(/Checking LocalStack/)).toBeDefined();
    expect(screen.queryByText(/No services reported/)).toBeNull();
  });

  it('explains that a generic endpoint has no inventory', () => {
    renderTable({}, { hasServiceInventory: false, providerLabel: 'AWS-compatible endpoint' });
    expect(screen.getByText(/does not expose a service inventory/)).toBeDefined();
  });
});
