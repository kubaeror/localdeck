// @vitest-environment jsdom
/**
 * Live EC2 console UI test against a *running* LocalDeck api and the external
 * LocalStack instance it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * The test renders the real console (the App shell plus the EC2 pages) over a
 * live instance it launches first: dashboard counts, the instances list, the
 * launch wizard's live summary, the instance detail tabs with the persistent
 * Emulated badge, and the terminate confirmation gate. The instance is
 * terminated by the flow itself and re-checked in `afterAll`.
 *
 * The instances list accumulates terminated records across LocalStack sessions,
 * so every list assertion filters down to this test's instance first — which is
 * also the console interaction a user would perform.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { listAllImages, listAllInstances, runInstances, terminateInstances } from './api';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

/** The live API is slower than the stubbed one; AMIs alone take over a second. */
const LIVE_TIMEOUT = { timeout: 20_000 };

/** Prefixes relative api paths with the live api base, like the dev proxy. */
function installLiveFetch(): void {
  const base = API_BASE ?? '';
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
    ),
  );
}

function renderApp(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const stamp = Date.now().toString(36);
const instanceName = `localdeck-ui-live-${stamp}`;
let instanceId = '';

/** Renders the instances list filtered down to this test's instance. */
async function renderFilteredInstances(): Promise<void> {
  renderApp('/console/ec2/instances');
  await screen.findByRole('heading', { level: 1, name: 'Instances' }, LIVE_TIMEOUT);
  const filterBox = await screen.findByRole('searchbox', { name: 'Filter instances' });
  fireEvent.change(filterBox, { target: { value: instanceName } });
  expect(await screen.findByText(instanceName, {}, LIVE_TIMEOUT)).toBeDefined();
}

liveDescribe('EC2 console pages against the external LocalStack', () => {
  beforeAll(async () => {
    installLiveFetch();

    const images = await listAllImages();
    const image = images.find((entry) => entry.state === 'available') ?? images[0];
    if (image === undefined) throw new Error('LocalStack returned no image to launch');

    const created = await runInstances({
      imageId: image.imageId,
      instanceType: 't3.micro',
      tags: [{ Key: 'Name', Value: instanceName }],
    });
    instanceId = created.instanceId;

    // The list page polls every 10 s; wait until the instance reports running
    // so the assertions below see a settled state.
    await waitFor(
      async () => {
        const instances = await listAllInstances();
        const state = instances.find((entry) => entry.instanceId === instanceId)?.state;
        expect(state).toBe('running');
      },
      { timeout: 30_000, interval: 500 },
    );
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    try {
      const instances = await listAllInstances();
      const state = instances.find((entry) => entry.instanceId === instanceId)?.state;
      if (state !== undefined && state !== 'terminated') await terminateInstances([instanceId]);
    } catch {
      // The flow already terminated the instance.
    }
    vi.unstubAllGlobals();
  });

  it('renders the dashboard with live counts and links', async () => {
    renderApp('/console/ec2');

    expect(
      await screen.findByRole('heading', { level: 1, name: /Dashboard/ }, LIVE_TIMEOUT),
    ).toBeDefined();
    for (const title of ['Instances', 'Volumes', 'Security groups', 'AMIs']) {
      expect(
        await screen.findByRole('heading', { level: 3, name: title }, LIVE_TIMEOUT),
      ).toBeDefined();
    }
    expect(await screen.findByRole('link', { name: 'View instances' })).toBeDefined();
    expect(await screen.findByRole('link', { name: 'View security groups' })).toBeDefined();
  }, 60_000);

  it('lists the live instance with its state and columns', async () => {
    await renderFilteredInstances();

    const table = await screen.findByRole('table');
    for (const header of ['Name', 'Instance ID', 'Instance state', 'Instance type']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeDefined();
    }
    expect(within(table).getByText('Running')).toBeDefined();
    // The list renders the header action twice: page header and table header.
    expect(screen.getAllByRole('button', { name: 'Launch instance' }).length).toBeGreaterThan(0);
  }, 60_000);

  it('keeps the launch wizard summary in sync while it is filled in', async () => {
    renderApp('/console/ec2/instances/launch');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Launch instance' }, LIVE_TIMEOUT),
    ).toBeDefined();
    const nameInput = await screen.findByPlaceholderText('web-server');
    fireEvent.change(nameInput, { target: { value: `draft-${stamp}` } });

    // The right-hand summary rail updates as soon as the field changes.
    expect(await screen.findByRole('heading', { level: 2, name: 'Launch summary' })).toBeDefined();
    expect(await screen.findByText(`draft-${stamp}`)).toBeDefined();

    // Moving on loads the live AMI catalogue; the first image is preselected,
    // so the summary names a real AMI instead of the placeholder.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: /Application and OS Images/ }),
    ).toBeDefined();
    expect((await screen.findAllByText(/ami-/, {}, LIVE_TIMEOUT)).length).toBeGreaterThan(0);
  }, 60_000);

  it('opens the instance detail with the persistent Emulated badge and tabs', async () => {
    renderApp(`/console/ec2/instances/${instanceId}`);

    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: new RegExp(instanceName) },
        LIVE_TIMEOUT,
      ),
    ).toBeDefined();
    expect((await screen.findAllByText('Emulated')).length).toBeGreaterThan(0);
    for (const tab of ['Details', 'Security', 'Storage', 'Tags']) {
      expect(screen.getByRole('tab', { name: tab })).toBeDefined();
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect((await screen.findAllByText('Emulated')).length).toBeGreaterThan(0);
  }, 60_000);

  it('gates termination behind the confirmation modal and shows the new state', async () => {
    await renderFilteredInstances();

    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${instanceName}` }));
    fireEvent.click(await screen.findByText('Terminate instance'));

    // The shell keeps the hidden "About LocalDeck" modal in the DOM, so pick
    // the dialog that actually shows the terminate confirmation.
    const dialogs = await screen.findAllByRole('dialog');
    const modal = dialogs.find(
      (dialog) => within(dialog).queryAllByText('Terminate instance').length > 0,
    );
    if (modal === undefined) throw new Error('the terminate confirmation modal is missing');
    const submit = within(modal).getByRole('button', { name: 'Terminate instance' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText(`Confirm terminate of ${instanceId}`), {
      target: { value: instanceId },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);

    // The list reloads after the call; the transition is visible as Terminated.
    expect(await screen.findByText('Terminated', {}, LIVE_TIMEOUT)).toBeDefined();
  }, 60_000);
});
