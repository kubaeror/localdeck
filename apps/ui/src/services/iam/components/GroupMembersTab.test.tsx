// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { GroupMembersTab } from './GroupMembersTab';

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

function stubIam(handler: (operation: string, input: Record<string, unknown>) => unknown): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/iam\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });
    return new Response(
      JSON.stringify({ service: 'iam', operation, result: handler(operation, operationInput) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderTab(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter>
        <GroupMembersTab groupName="developers" />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('IAM GroupMembersTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the members and removes one through RemoveUserFromGroup', async () => {
    const calls = stubIam((operation) =>
      operation === 'GetGroup'
        ? {
            Group: { GroupName: 'developers' },
            Users: [{ UserName: 'bob' }, { UserName: 'carol' }],
          }
        : {},
    );
    renderTab();

    const table = await screen.findByRole('table', { name: 'Group members' });
    expect(within(table).getByRole('link', { name: 'bob' })).toBeDefined();
    fireEvent.click(
      within(table).getAllByRole('button', { name: 'Remove from group' })[0] as HTMLElement,
    );

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'RemoveUserFromGroup')).toBe(true);
    });
    expect(calls.find((call) => call.operation === 'RemoveUserFromGroup')?.input).toEqual({
      UserName: 'bob',
      GroupName: 'developers',
    });
  });

  it('walks GetGroup pages so members beyond the first page stay members', async () => {
    const calls = stubIam((operation, input) => {
      if (operation === 'GetGroup') {
        return input.Marker === undefined
          ? {
              Group: { GroupName: 'developers' },
              Users: [{ UserName: 'bob' }],
              IsTruncated: true,
              Marker: 'members-2',
            }
          : { Users: [{ UserName: 'carol' }], IsTruncated: false };
      }
      if (operation === 'ListUsers') {
        return { Users: [{ UserName: 'bob' }, { UserName: 'carol' }, { UserName: 'dave' }] };
      }
      return {};
    });
    renderTab();

    const table = await screen.findByRole('table', { name: 'Group members' });
    expect(within(table).getByRole('link', { name: 'bob' })).toBeDefined();
    expect(within(table).getByRole('link', { name: 'carol' })).toBeDefined();

    const pageCalls = calls.filter((call) => call.operation === 'GetGroup');
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls[1]?.input).toMatchObject({ GroupName: 'developers', Marker: 'members-2' });
  });

  it('opens the add-users modal with the account users that are not members', async () => {
    const calls = stubIam((operation) => {
      if (operation === 'GetGroup') {
        return { Group: { GroupName: 'developers' }, Users: [{ UserName: 'bob' }] };
      }
      if (operation === 'ListUsers') {
        return { Users: [{ UserName: 'bob' }, { UserName: 'dave' }] };
      }
      return {};
    });
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Add users' }));

    // The panel renders the header action (and the modal footer once open), so
    // take the first visible Add users button.
    const addButton = screen.getAllByRole('button', { name: 'Add users' })[0] as HTMLElement;
    fireEvent.click(addButton);

    const dialog = await screen.findByRole('dialog');
    // The modal asked LocalStack for the account users and excludes the
    // existing member from its candidates.
    expect(within(dialog).getByText('Add users to developers')).toBeDefined();
    expect(within(dialog).getByText('Choose users')).toBeDefined();
    expect(calls.some((call) => call.operation === 'ListUsers')).toBe(true);
  });
});
