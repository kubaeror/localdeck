// @vitest-environment jsdom
import { SERVICE_CATALOG, type EmulatorServiceState } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  dispatchedOperationCalls,
  REPORTED_SERVICES,
  stubApiFetch,
  TEST_HEALTH,
} from '../test/fixtures';

function renderApp(initialEntries: readonly string[] = ['/console/home']): void {
  render(
    <MemoryRouter initialEntries={[...initialEntries]}>
      <App />
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('renders the console chrome: brand, region, search, terminal, help and the local user', async () => {
    renderApp();

    expect(screen.getAllByText('LocalDeck').length).toBeGreaterThan(0);
    // Cloudscape renders an aria-hidden copy of the utilities for overflow
    // measurement, so the region label legitimately appears twice.
    expect((await screen.findAllByText('us-east-1 (local)')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Search services/ }).length).toBeGreaterThan(0);
    // The terminal is a placeholder behind VITE_TERMINAL_ENABLED, so it is
    // hidden from the default build.
    expect(screen.queryByRole('button', { name: 'Terminal (not implemented yet)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Help' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Signed in as local' })).toBeDefined();

    // Legal notice lives in the app footer.
    expect(
      screen.getAllByText(/Amazon Web Services, AWS and the Powered by AWS logo are trademarks/)
        .length,
    ).toBeGreaterThan(0);
  });

  it('redirects the console root to Console Home', async () => {
    renderApp(['/']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Console Home' })).toBeDefined();
  });

  it('shows the live LocalStack status on Console Home', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { level: 2, name: 'Service health' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Recently visited' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 2, name: 'Quick actions' })).toBeDefined();

    // Real values from /api/health, not placeholders.
    expect((await screen.findAllByText('Connected')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('http://localhost:4566').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026.8.2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LocalStack (pro)').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `${TEST_HEALTH.emulator.counts.enabled} of ${TEST_HEALTH.emulator.counts.total} available`,
      ),
    ).toBeDefined();
  });

  it('groups the sidebar by console category and greys out services the stack does not report', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    expect(screen.getAllByText('Storage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Compute').length).toBeGreaterThan(0);

    const s3 = screen.getByRole('link', { name: 'S3' });
    expect(s3.parentElement?.textContent).not.toContain('not reported');

    // EC2 is registered but not reported by the stubbed stack.
    const ec2 = screen.getByRole('link', { name: 'EC2' });
    expect(ec2.parentElement?.textContent).toContain('not reported');

    // Every service that is not enabled carries a badge: `not reported` for
    // services the stack omits, `starting` for the one still coming up.
    const enabled = TEST_HEALTH.emulator.counts.enabled;
    const starting = Object.values(REPORTED_SERVICES).filter(
      (state) => state === 'starting',
    ).length;
    expect(screen.getAllByText('not reported')).toHaveLength(
      SERVICE_CATALOG.length - enabled - starting,
    );

    // The sidebar reports how much of the stack the registry covers.
    expect(
      screen.getByText(`${enabled} of ${SERVICE_CATALOG.length} services reported by LocalStack`),
    ).toBeDefined();
  });

  it('keeps the app.css grey-out hook matching the rendered navigation', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    // Must stay in sync with the selector in src/styles/app.css.
    const greyOutSelector = '.app-shell__nav a:has(+ span > .app-shell__nav-unavailable)';

    const lightsail = document.querySelector('a[href="/console/lightsail"]');
    expect(lightsail?.matches(greyOutSelector)).toBe(true);

    const s3 = screen.getByRole('link', { name: 'S3' });
    expect(s3.matches(greyOutSelector)).toBe(false);

    // Every non-enabled service link carries the grey-out hook, including the
    // `starting` one.
    const greyed = SERVICE_CATALOG.length - TEST_HEALTH.emulator.counts.enabled;
    expect(document.querySelectorAll(greyOutSelector)).toHaveLength(greyed);
  });

  it('shows the tooltip wording behind a greyed out entry', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    const markers = screen.getAllByLabelText(/does not report this service/);
    expect(markers.length).toBeGreaterThan(0);
    const marker = markers[0];
    if (marker === undefined) throw new Error('no "not reported" marker was rendered');

    fireEvent.pointerEnter(marker);
    expect(await screen.findByText(/does not report this service/)).toBeDefined();
  });

  it('filters the sidebar', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter services' }), {
      target: { value: 's3' },
    });

    expect(screen.getByRole('link', { name: 'S3' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'EC2' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Console Home' })).toBeNull();
  });

  it('routes every service entry to a per-service placeholder', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    // Lightsail has no dedicated module folder, so the shell renders its
    // placeholder with the registry entry instead of a fake console.
    fireEvent.click(screen.getByRole('link', { name: 'Lightsail' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Lightsail' })).toBeDefined();
    expect(screen.getByText('The Lightsail console is not implemented yet')).toBeDefined();
    expect(
      screen.getByText('Simplified virtual private servers with bundled networking.'),
    ).toBeDefined();
    // Breadcrumbs: Console Home / Lightsail
    expect(screen.getAllByRole('link', { name: 'Console Home' }).length).toBeGreaterThan(1);
    // Registry metadata is shown instead of fake data.
    expect(screen.getByText('@aws-sdk/client-lightsail')).toBeDefined();
    expect(screen.getByText('GetInstances')).toBeDefined();
  });

  it('renders the s3 module: bucket list with live buckets from the dispatcher', async () => {
    renderApp(['/console/s3']);

    // The module replaces the placeholder page…
    expect(await screen.findByRole('heading', { level: 1, name: 'Buckets' })).toBeDefined();
    expect(screen.queryByText('The S3 console is not implemented yet')).toBeNull();

    // …and its list page renders rows returned by the api dispatcher.
    const table = await screen.findByRole('table');
    expect(await screen.findByText('alpha-bucket')).toBeDefined();
    expect(within(table).getByText('beta-bucket')).toBeDefined();
    expect(dispatchedOperationCalls('s3', 'ListBuckets')).toBeGreaterThan(0);
  });

  it('creates a bucket through the s3 create wizard', async () => {
    stubApiFetch({
      operations: {
        's3/ListBuckets': {
          service: 's3',
          operation: 'ListBuckets',
          result: { Buckets: [{ Name: 'new-bucket' }] },
        },
      },
    });
    renderApp(['/console/s3/create']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Create bucket' })).toBeDefined();
    // Right-hand summary column of the wizard.
    expect(screen.getByText('Bucket summary')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'new-bucket' },
    });
    // Versioning, Tags, Block Public Access and Review.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create bucket' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'CreateBucket')).toBe(1);
    });
    // CreateBucket plus the Block Public Access settings the console applies.
    await waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'PutPublicAccessBlock')).toBe(1);
    });
    // The console reports the outcome through the global flashbar and opens
    // the new bucket.
    expect(await screen.findByText('Bucket created')).toBeDefined();
    expect(await screen.findByRole('heading', { level: 1, name: 'new-bucket' })).toBeDefined();
  });

  it('rejects an invalid bucket name in the wizard before calling the api', async () => {
    renderApp(['/console/s3/create']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Create bucket' })).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Bucket name' }), {
      target: { value: 'Bad_Bucket' },
    });
    expect(await screen.findByText(/Bucket name can only contain lowercase letters/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(dispatchedOperationCalls('s3', 'CreateBucket')).toBe(0);
  });

  it('explains the missing sdk package when the dispatcher answers 501', async () => {
    renderApp(['/console/sqs']);

    // sqs has no module folder, so the generated browser renders the list page…
    expect(await screen.findByRole('heading', { level: 1, name: 'SQS resources' })).toBeDefined();
    // …and surfaces the api's 501 for the list operation instead of a raw error.
    expect(
      await screen.findByText('This service is not installed on the LocalDeck api'),
    ).toBeDefined();
    expect(screen.getByText(/does not have the SDK package for sqs\/ListQueues/)).toBeDefined();
  });

  it('warns on the placeholder page when the stack does not emulate the service', async () => {
    renderApp(['/console/lightsail']);

    expect(await screen.findByText('Lightsail is not available from LocalStack')).toBeDefined();
    expect(screen.getByText('The Lightsail console is not implemented yet')).toBeDefined();
  });

  it('refreshes the stack status from the region menu', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    const fetchMock = vi.mocked(globalThis.fetch);
    const healthCalls = (): number =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/health')).length;
    const before = healthCalls();

    const regionButtons = screen.getAllByRole('button', { name: 'Region and stack details' });
    const regionButton = regionButtons[0];
    if (regionButton === undefined) throw new Error('the region utility is missing');
    fireEvent.click(regionButton);
    fireEvent.click(await screen.findByText('Refresh status'));

    await waitFor(() => {
      expect(healthCalls()).toBeGreaterThan(before);
    });
  });

  it('keeps the terminal as an explicit placeholder behind its feature flag', async () => {
    vi.stubEnv('VITE_TERMINAL_ENABLED', 'true');
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    fireEvent.click(screen.getByRole('button', { name: 'Terminal (not implemented yet)' }));

    const item = await screen.findByText('Not implemented yet');
    expect(item).toBeDefined();
    // The dropdown entry is rendered as a disabled option: it states the
    // placeholder instead of pretending to open a terminal.
    expect(item.closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('opens the global search from the top navigation and routes to the service', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: 'Search services' });

    fireEvent.change(input, { target: { value: 'dynamodb' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // DynamoDB has no dedicated folder: the registry's browser binding renders
    // the generated resource list.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'DynamoDB resources' }),
    ).toBeDefined();
  });

  it('keeps the recently visited trail and reports it through the flashbar', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    // Nothing visited yet: the widget shows its empty state and the quick
    // action is disabled.
    expect(screen.getByText('Nothing visited yet')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Clear recently visited' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'S3' }));
    await screen.findByRole('heading', { level: 1, name: 'Buckets' });

    const homeLinks = screen.getAllByRole('link', { name: 'Console Home' });
    const homeLink = homeLinks[0];
    if (homeLink === undefined) throw new Error('the sidebar Console Home link is missing');
    fireEvent.click(homeLink);
    const recent = await screen.findByLabelText('Recently visited services');
    expect(within(recent).getByText('S3')).toBeDefined();

    const clear = screen.getByRole('button', {
      name: 'Clear recently visited',
    }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(clear);

    expect(await screen.findByText('Recently visited cleared')).toBeDefined();
    expect(screen.getByText('Nothing visited yet')).toBeDefined();
  });

  it('clears the recently visited trail from the user menu', async () => {
    renderApp(['/console/lambda']);

    fireEvent.click(screen.getByRole('button', { name: 'Signed in as local' }));
    fireEvent.click(await screen.findByText('Clear recently visited list'));

    expect(await screen.findByText('Recently visited cleared')).toBeDefined();
  });

  it('explains the endpoint from the help menu', async () => {
    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(await screen.findByText('About this console'));

    expect(await screen.findByText('About LocalDeck')).toBeDefined();
    expect(screen.getByText(/services \(from the LocalDeck api\)/)).toBeDefined();
    expect(screen.getByText('Keyboard shortcuts')).toBeDefined();
  });

  it('reports an unreachable LocalStack without breaking the console', async () => {
    stubApiFetch({ unreachable: true });
    renderApp();

    expect(await screen.findByText('LocalStack is not reachable')).toBeDefined();
    // The sidebar still renders the registry, all greyed out. With no health
    // document there is no inventory to compare against, so the badges read
    // "unverified" instead of claiming the service is absent.
    expect(screen.getByRole('link', { name: 'S3' }).parentElement?.textContent).toContain(
      'unverified',
    );
    expect(
      screen.getByText(`0 of ${SERVICE_CATALOG.length} services reported by LocalStack`),
    ).toBeDefined();
  });

  it('lists the full registry with live statuses on the All services page', async () => {
    renderApp(['/console/services']);

    expect(await screen.findByRole('heading', { level: 1, name: 'All services' })).toBeDefined();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Not reported by LocalStack').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter the service registry' }), {
      target: { value: 's3' },
    });
    expect(within(table).getByRole('link', { name: 'S3' })).toBeDefined();
  });

  it('shows LocalStack status details on the service health page', async () => {
    renderApp(['/console/health']);

    expect(await screen.findByRole('heading', { level: 1, name: 'Service health' })).toBeDefined();
    expect(await screen.findByText('Registry coverage')).toBeDefined();
    expect(screen.getByText('Registered services')).toBeDefined();
  });

  it('renders the not-found page for unknown routes', async () => {
    renderApp(['/nope']);

    expect(await screen.findByText('Page not found')).toBeDefined();
  });

  it('renders the not-found page for unknown service ids', async () => {
    renderApp(['/console/not-a-service']);

    expect(await screen.findByText('Page not found')).toBeDefined();
  });
});

describe('AppShell (service status shape)', () => {
  it('greys out services the provider reports as disabled, never enabled ones', async () => {
    const services: Record<string, EmulatorServiceState> = {
      ...REPORTED_SERVICES,
      ec2: 'disabled',
    };
    stubApiFetch({
      health: { ...TEST_HEALTH, emulator: { ...TEST_HEALTH.emulator, services } },
    });

    renderApp();
    await screen.findAllByText('us-east-1 (local)');

    const ec2 = screen.getByRole('link', { name: 'EC2' });
    expect(ec2.parentElement?.textContent).toContain('disabled');
    const s3 = screen.getByRole('link', { name: 'S3' });
    expect(s3.parentElement?.textContent).not.toContain('disabled');

    cleanup();
    vi.unstubAllGlobals();
  });
});
