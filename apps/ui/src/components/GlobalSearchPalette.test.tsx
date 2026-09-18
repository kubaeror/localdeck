// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../contexts/FlashbarProvider';
import { GlobalSearchProvider } from '../contexts/GlobalSearchProvider';
import { LocalStackStatusProvider } from '../contexts/LocalStackStatusProvider';
import { RecentlyVisitedProvider } from '../contexts/RecentlyVisitedProvider';
import { ServiceCatalogProvider } from '../contexts/ServiceCatalogProvider';
import { stubApiFetch } from '../test/fixtures';
import { GlobalSearchPalette } from './GlobalSearchPalette';

function renderSearchApp(): void {
  render(
    <MemoryRouter initialEntries={['/console/home']}>
      <FlashbarProvider>
        <LocalStackStatusProvider>
          <ServiceCatalogProvider>
            <RecentlyVisitedProvider>
              <GlobalSearchProvider>
                <Routes>
                  <Route path="/console/home" element={<div>console home stub</div>} />
                  <Route path="/console/s3" element={<div>s3 console placeholder</div>} />
                  <Route path="/console/lambda" element={<div>lambda console placeholder</div>} />
                </Routes>
              </GlobalSearchProvider>
            </RecentlyVisitedProvider>
          </ServiceCatalogProvider>
        </LocalStackStatusProvider>
      </FlashbarProvider>
    </MemoryRouter>,
  );
}

function searchBox(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Search services' });
}

function resultRows(): readonly HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.console-search__result'));
}

describe('GlobalSearchPalette', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens with Ctrl+/ and routes to the highlighted service on Enter', async () => {
    renderSearchApp();
    expect(screen.queryByText('Search services')).toBeNull();

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(await screen.findByText('Search services')).toBeDefined();

    fireEvent.change(searchBox(), { target: { value: 's3' } });
    const results = screen.getByLabelText('Search results');
    expect(within(results).getByText('S3')).toBeDefined();

    fireEvent.keyDown(searchBox(), { key: 'Enter' });

    expect(await screen.findByText('s3 console placeholder')).toBeDefined();
    expect(screen.queryByText('Search services')).toBeNull();
  });

  it('fuzzy-matches across the registry, not just names', async () => {
    renderSearchApp();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });

    // "ReceiveMessage" only appears in the descriptor text (operations), not in
    // any service name — proving the palette searches the whole descriptor.
    fireEvent.change(searchBox(), { target: { value: 'ReceiveMessage' } });

    const results = screen.getByLabelText('Search results');
    expect(within(results).getByText('SQS')).toBeDefined();
    expect(within(results).queryByText('Lambda')).toBeNull();
  });

  it('shows the registry size and a hint before typing', async () => {
    renderSearchApp();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });

    expect(await screen.findByText(/services in the registry\.$/)).toBeDefined();
    expect(screen.getByText(/Search the whole LocalDeck registry/)).toBeDefined();
  });

  it('reports when nothing matches', async () => {
    renderSearchApp();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });

    // No service text can contain this, so the query matches nothing.
    fireEvent.change(searchBox(), { target: { value: '$$$' } });

    expect(await screen.findByText(/No service matches/)).toBeDefined();
  });

  it('moves the highlight with the arrow keys', async () => {
    renderSearchApp();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    fireEvent.change(searchBox(), { target: { value: 's' } });

    expect(resultRows()[0]?.style.background).not.toBe('');

    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' });
    expect(resultRows()[1]?.style.background).not.toBe('');

    fireEvent.keyDown(searchBox(), { key: 'ArrowUp' });
    expect(resultRows()[0]?.style.background).not.toBe('');
    expect(resultRows()[1]?.style.background).toBe('');
  });

  it('closes when the modal close button is used', async () => {
    const onDismiss = vi.fn();
    render(
      <MemoryRouter>
        <FlashbarProvider>
          <LocalStackStatusProvider>
            <ServiceCatalogProvider>
              <RecentlyVisitedProvider>
                <GlobalSearchPaletteHarness onDismiss={onDismiss} />
              </RecentlyVisitedProvider>
            </ServiceCatalogProvider>
          </LocalStackStatusProvider>
        </FlashbarProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Close search' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

/** Renders the palette directly; the provider owns the open state in the app. */
function GlobalSearchPaletteHarness({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  return <GlobalSearchPalette onDismiss={onDismiss} />;
}
