import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleErrorBoundary } from './ConsoleErrorBoundary';

function Boom(): ReactElement {
  throw new Error('render exploded');
}

function renderBoundary(): void {
  render(
    <MemoryRouter initialEntries={['/console/boom']}>
      <ConsoleErrorBoundary scope="test">
        <Routes>
          <Route path="/console/boom" element={<Boom />} />
          <Route path="/console/home" element={<div>console home restored</div>} />
        </Routes>
      </ConsoleErrorBoundary>
    </MemoryRouter>,
  );
}

describe('ConsoleErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a recovery fallback instead of a white screen', () => {
    // React logs caught render errors; the boundary also logs them through
    // console.error on purpose. Silence both for the assertion run.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderBoundary();

    expect(screen.getByText('This view crashed')).toBeDefined();
    expect(screen.getByText('render exploded')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Back to Console Home' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeDefined();
  });

  it('remounts the boundary and navigates home when recovery is used', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderBoundary();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Console Home' }));

    expect(screen.getByText('console home restored')).toBeDefined();
    expect(screen.queryByText('This view crashed')).toBeNull();
  });
});
