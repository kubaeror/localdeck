// @vitest-environment jsdom
/**
 * Live console smoke test against a *running* LocalDeck api and the external
 * LocalStack instance it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 */
import { SERVICE_CATALOG, summarizeRegistryCoverage } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, describe, vi } from 'vitest';
import { App } from './App';

/** Dispatcher calls the live api served for s3/ListBuckets. */
function dispatchedS3ListCalls(): number {
  const mock = vi.mocked(globalThis.fetch);
  return mock.mock.calls.filter(([input]) => String(input).includes('/api/services/s3/ListBuckets'))
    .length;
}

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

function renderApp(initialEntries: readonly string[]): void {
  render(
    <MemoryRouter initialEntries={[...initialEntries]}>
      <App />
    </MemoryRouter>,
  );
}

liveDescribe('live console against the external LocalStack', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the real stack, the real registry coverage and live statuses', async () => {
    const base = API_BASE ?? '';
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
      ),
    );

    const health = (await (await realFetch(`${base}/api/health`)).json()) as {
      endpoint: string;
      region: string;
      provider: {
        provider: 'localstack' | 'floci' | 'ministack' | 'generic';
        providerLabel: string;
        version: string | null;
        edition: string | null;
        docsUrl: string;
      };
      emulator: {
        provider: 'localstack' | 'floci' | 'ministack' | 'generic';
        providerLabel: string;
        version: string | null;
        edition: string | null;
        hasServiceInventory: boolean;
        services: Record<string, 'enabled' | 'disabled' | 'starting' | 'error' | 'unknown'>;
        counts: { enabled: number; disabled: number; total: number; error: number; other: number };
      };
    };
    const registry = (await (await realFetch(`${base}/api/services`)).json()) as {
      services?: { id: string; available?: boolean }[];
    };
    expect(registry.services).toBeDefined();
    const registryServices = registry.services ?? [];

    const coverage = summarizeRegistryCoverage(
      health.emulator.services,
      SERVICE_CATALOG,
      health.provider.provider,
    );
    // The sidebar shows one badge per service and "not installed" (the api has
    // no SDK package for it) wins over "not reported"; compute both counts
    // against the registry the api actually served.
    const notInstalled = new Set(
      registryServices
        .filter((service) => service.available === false)
        .map((service) => service.id),
    );
    const notReportedBadges = coverage.notEmulated.filter((id) => !notInstalled.has(id)).length;
    const registeredCount = registryServices.length || SERVICE_CATALOG.length;

    renderApp(['/console/home']);

    // Endpoint, region, stack identity and emulated-service counts are real.
    expect((await screen.findAllByText(health.endpoint)).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        `${health.emulator.counts.enabled} of ${health.emulator.counts.total} available`,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        `${health.provider.providerLabel} (${health.provider.edition ?? 'unknown'})`,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(health.provider.version ?? 'unknown').length).toBeGreaterThan(0);

    // The sidebar is the registry matched against this exact health document:
    // every service LocalStack does not report is greyed out, and nothing else.
    await waitFor(() => {
      expect(
        screen.getByText(
          `${coverage.emulated} of ${registeredCount} services reported by LocalStack`,
        ),
      ).toBeDefined();
    });
    expect(screen.queryAllByText('not reported')).toHaveLength(notReportedBadges);

    console.log(
      `Live LocalStack ${health.emulator.version ?? '?'} (${health.emulator.edition ?? '?'}) at ${health.endpoint}: ` +
        `${health.emulator.counts.total} services reported, ${coverage.emulated}/${SERVICE_CATALOG.length} registry entries emulated, ` +
        `${coverage.notEmulated.length} greyed out (${coverage.notEmulated.join(', ') || 'none'}), ` +
        `${coverage.unregistered.length} reported services without a console entry.`,
    );

    // A service this stack reports must be selectable and route to its console.
    // S3 has a dedicated module, so it renders the real console instead of the
    // placeholder; the bucket list is fed by the api's dynamic dispatcher.
    const s3 = screen.getAllByRole('link', { name: 'S3' })[0];
    if (s3 === undefined) throw new Error('the S3 entry is missing from the sidebar');
    expect(s3.parentElement?.textContent).not.toContain('not reported');
    fireEvent.click(s3);
    expect(await screen.findByRole('heading', { level: 1, name: 'Buckets' })).toBeDefined();
    expect(screen.queryByText('The S3 console is not implemented yet')).toBeNull();
    // Real buckets (or the real empty state) come back through the dispatcher.
    await waitFor(() => {
      expect(dispatchedS3ListCalls()).toBeGreaterThan(0);
    });

    // A registry service without a module still explains itself.
    cleanup();
    renderApp(['/console/lightsail']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Lightsail' })).toBeDefined();
    expect(screen.getByText('The Lightsail console is not implemented yet')).toBeDefined();

    // The registry page shows live statuses and live parity metadata.
    cleanup();
    renderApp(['/console/services']);
    const table = await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the service registry' }), {
      target: { value: 's3' },
    });
    expect(within(table).getByRole('link', { name: 'S3' })).toBeDefined();
    // The health poll and the registry fetch resolve independently; re-query
    // the table so the assertion reads the current node.
    await waitFor(
      () => {
        const current = screen.getByRole('table');
        expect(current.textContent).toContain('Enabled');
        expect(current.textContent).toContain('Dedicated console');
      },
      { timeout: 10_000 },
    );

    vi.unstubAllGlobals();
  }, 60_000);
});
