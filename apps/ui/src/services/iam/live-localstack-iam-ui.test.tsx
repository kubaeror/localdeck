// @vitest-environment jsdom
/**
 * Live IAM console UI test against a *running* LocalDeck api and the external
 * LocalStack instance it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * Unlike the S3 module's live test, this one renders the real console (the App
 * shell plus the IAM pages) and drives the create wizards far enough to prove
 * the client-side validation stops invalid documents with the console's own
 * messages.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

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

liveDescribe('IAM console pages against the external LocalStack', () => {
  beforeAll(() => {
    installLiveFetch();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('renders the dashboard with live counts and section links', async () => {
    renderApp('/console/iam');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeDefined();
    for (const title of ['Users', 'User groups', 'Roles', 'Customer managed policies']) {
      expect(await screen.findByRole('heading', { level: 3, name: title })).toBeDefined();
    }
    expect(await screen.findByRole('link', { name: 'View users' })).toBeDefined();
    expect(await screen.findByRole('link', { name: 'View policies' })).toBeDefined();
  });

  it('renders the live users, groups, roles and policies lists', async () => {
    renderApp('/console/iam/users');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeDefined();
    expect(await screen.findByRole('columnheader', { name: 'User ARN' })).toBeDefined();

    cleanup();
    renderApp('/console/iam/groups');
    expect(await screen.findByRole('heading', { level: 1, name: 'User groups' })).toBeDefined();

    cleanup();
    renderApp('/console/iam/roles');
    expect(await screen.findByRole('heading', { level: 1, name: 'Roles' })).toBeDefined();

    cleanup();
    renderApp('/console/iam/policies');
    expect(await screen.findByRole('heading', { level: 1, name: 'Policies' })).toBeDefined();
    // The scope selector is the console's customer/AWS managed split.
    expect(await screen.findByRole('button', { name: 'AWS managed' })).toBeDefined();
  });

  it('blocks the create-policy wizard while the policy has no actions', async () => {
    renderApp('/console/iam/policies/create');

    expect(await screen.findByRole('heading', { level: 1, name: 'Create policy' })).toBeDefined();
    // The default document has an empty Action array; the visual editor flags
    // it and the wizard refuses to advance to the review step.
    expect(await screen.findByText('Select at least one action.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Create policy' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      (await screen.findAllByText(/Statement\[0\] "Action" must be a string or an array/)).length,
    ).toBeGreaterThan(0);
    // Still on step 1: the submit button only appears on the review step.
    expect(screen.queryByRole('button', { name: 'Create policy' })).toBeNull();
  });

  it('blocks the create-role wizard without a trusted entity', async () => {
    renderApp('/console/iam/roles/create');

    expect(await screen.findByRole('heading', { level: 1, name: 'Create role' })).toBeDefined();
    expect((await screen.findAllByText('Trusted entity type')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect((await screen.findAllByText('Select at least one AWS service.')).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
  });

  it('blocks the create-user wizard on an invalid user name', async () => {
    renderApp('/console/iam/users/create');

    expect(await screen.findByRole('heading', { level: 1, name: 'Create user' })).toBeDefined();
    const input = await screen.findByPlaceholderText('alice');
    fireEvent.change(input, { target: { value: 'bad name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      (await screen.findAllByText(/alphanumeric characters and \+=,.@_-/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Create user' })).toBeNull();
  });
});
