// @vitest-environment jsdom
import { SERVICE_CATALOG } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentlyVisitedProvider } from '../contexts/RecentlyVisitedProvider';
import { ServiceModuleOutlet } from './ServiceModuleOutlet';
import { loadServiceModule } from './modules';
import type { UiServiceModule } from './types';

// The outlet only consumes `loadServiceModule`; the real one is replaced so a
// dynamic-import failure can be simulated without a broken chunk on disk.
vi.mock('./modules', () => ({
  loadServiceModule: vi.fn(),
}));

const loadServiceModuleMock = vi.mocked(loadServiceModule);

function findDescriptor(id: string): UiServiceModule['descriptor'] {
  const found = SERVICE_CATALOG.find((service) => service.id === id);
  if (found === undefined) throw new Error(`test fixture: the ${id} registry entry is missing`);
  return found;
}

const descriptor = findDescriptor('sns');

function loadedModule(): UiServiceModule {
  return {
    descriptor,
    spec: {
      descriptor,
      operations: [],
      capabilities: { list: true, detail: false, create: false },
    },
    routes: [{ path: '', title: 'Resources', page: 'list' }],
    pages: { list: () => <div>loaded console</div> },
  };
}

function renderOutlet(): void {
  render(
    <MemoryRouter initialEntries={['/console/sns']}>
      <RecentlyVisitedProvider>
        <Routes>
          <Route path="/console/:serviceId/*" element={<ServiceModuleOutlet />} />
        </Routes>
      </RecentlyVisitedProvider>
    </MemoryRouter>,
  );
}

describe('ServiceModuleOutlet', () => {
  beforeEach(() => {
    loadServiceModuleMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a retryable error when the dynamic import rejects', async () => {
    loadServiceModuleMock.mockRejectedValueOnce(
      new Error('Failed to fetch dynamically imported module'),
    );

    renderOutlet();

    expect(await screen.findByText('Could not load this service console')).toBeDefined();
    expect(screen.getByText(/Failed to fetch dynamically imported module/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByText('loaded console')).toBeNull();
  });

  it('retries the dynamic import after a chunk load failure', async () => {
    loadServiceModuleMock
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(loadedModule());

    renderOutlet();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('loaded console')).toBeDefined();
    expect(screen.queryByText('Could not load this service console')).toBeNull();
    expect(loadServiceModuleMock).toHaveBeenCalledTimes(2);
  });
});
