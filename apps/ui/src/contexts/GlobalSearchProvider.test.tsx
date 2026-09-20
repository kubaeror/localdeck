import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearchProvider } from './GlobalSearchProvider';
import { EmulatorStatusProvider } from './EmulatorStatusProvider';
import { RecentlyVisitedProvider } from './RecentlyVisitedProvider';
import { ServiceCatalogProvider } from './ServiceCatalogProvider';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { stubApiFetch } from '../test/fixtures';
import { MemoryRouter } from 'react-router-dom';

function Consumer(): ReactElement {
  const { isOpen, open, close } = useGlobalSearch();
  return (
    <div>
      <span data-testid="open">{String(isOpen)}</span>
      <button
        onClick={() => {
          open();
        }}
      >
        open search
      </button>
      <button
        onClick={() => {
          close();
        }}
      >
        close search
      </button>
    </div>
  );
}

function renderProvider(): void {
  render(
    <MemoryRouter initialEntries={['/console/home']}>
      <EmulatorStatusProvider>
        <ServiceCatalogProvider>
          <RecentlyVisitedProvider>
            <GlobalSearchProvider>
              <Consumer />
            </GlobalSearchProvider>
          </RecentlyVisitedProvider>
        </ServiceCatalogProvider>
      </EmulatorStatusProvider>
    </MemoryRouter>,
  );
}

describe('GlobalSearchProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens the palette from the keyboard shortcut and toggles it closed', async () => {
    renderProvider();
    expect(screen.getByTestId('open').textContent).toBe('false');

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true');
    });
    expect(await screen.findByText('Search services')).toBeDefined();

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('false');
    });
  });

  it('accepts Cmd+/ like the platform-aware label says', async () => {
    renderProvider();

    fireEvent.keyDown(window, { key: '/', metaKey: true });

    await waitFor(() => {
      expect(screen.getByTestId('open').textContent).toBe('true');
    });
  });

  it('exposes open and close through the context', async () => {
    renderProvider();

    fireEvent.click(screen.getByText('open search'));
    expect(await screen.findByText('Search services')).toBeDefined();

    fireEvent.click(screen.getByText('close search'));
    await waitFor(() => {
      expect(screen.queryByText('Search services')).toBeNull();
    });
  });
});
