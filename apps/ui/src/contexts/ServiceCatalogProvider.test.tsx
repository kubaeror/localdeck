import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceCatalogProvider } from './ServiceCatalogProvider';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import { jsonResponse, TEST_CONFIG, TEST_HEALTH, TEST_REGISTRY } from '../test/fixtures';

function Consumer(): ReactElement {
  const { services, source } = useServiceCatalog();
  return (
    <div>
      <span data-testid="source">{source}</span>
      <span data-testid="count">{services.length}</span>
    </div>
  );
}

function renderProvider(): void {
  render(
    <ServiceCatalogProvider>
      <Consumer />
    </ServiceCatalogProvider>,
  );
}

describe('ServiceCatalogProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts from the bundled registry and adopts the api registry', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/services')) return jsonResponse(TEST_REGISTRY);
      if (url.includes('/api/config')) return jsonResponse(TEST_CONFIG);
      if (url.includes('/api/health')) return jsonResponse(TEST_HEALTH);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();
    // The bundled registry is available immediately, before the api answers.
    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThan(0);
    expect(screen.getByTestId('source').textContent).toBe('bundled');

    expect(await screen.findByText('api')).toBeDefined();
    expect(screen.getByTestId('count').textContent).toBe(String(TEST_REGISTRY.services.length));
  });

  it('keeps the bundled registry when the api is down', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/services')) {
        return jsonResponse({ error: { code: 'INTERNAL', statusCode: 500, message: 'boom' } }, 500);
      }
      if (url.includes('/api/config')) return jsonResponse(TEST_CONFIG);
      if (url.includes('/api/health')) return jsonResponse(TEST_HEALTH);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();

    // Give the failed request time to settle, then assert the fallback held.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('source').textContent).toBe('bundled');
    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThan(0);
  });
});
