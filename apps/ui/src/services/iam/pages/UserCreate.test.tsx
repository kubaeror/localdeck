// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { UserCreatePage } from './UserCreate';

const IAM = ((): ServiceDescriptor => {
  const service = findService('iam');
  if (service === undefined) throw new Error('iam must be registered');
  return service;
})();

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

function stubIam(handler: (operation: string) => unknown): Call[] {
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
    calls.push({ operation, input: body.input ?? {} });
    return new Response(JSON.stringify({ service: 'iam', operation, result: handler(operation) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderWizard(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/iam/users/create']}>
        <Routes>
          <Route path="/console/iam/users/create" element={<UserCreatePage descriptor={IAM} />} />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

function clickNext(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('IAM UserCreatePage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits trimmed, key-only tags after validating every step', async () => {
    const calls = stubIam((operation) => {
      if (operation === 'ListGroups') return { Groups: [{ GroupName: 'developers' }] };
      if (operation === 'CreateUser') return { User: { UserName: 'alice' } };
      return {};
    });
    renderWizard();

    fireEvent.change(await screen.findByPlaceholderText('alice'), {
      target: { value: 'alice' },
    });
    clickNext(); // access
    clickNext(); // groups
    clickNext(); // tags
    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag key 1'), { target: { value: ' team ' } });
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'core' } });
    clickNext(); // review
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'CreateUser')).toBe(true);
    });
    expect(calls.find((call) => call.operation === 'CreateUser')?.input).toEqual({
      UserName: 'alice',
      Tags: [{ Key: 'team', Value: 'core' }],
    });
  });

  it('cannot reach review while a tag row has no key', async () => {
    const calls = stubIam((operation) => {
      if (operation === 'ListGroups') return { Groups: [] };
      return { User: { UserName: 'alice' } };
    });
    renderWizard();

    fireEvent.change(await screen.findByPlaceholderText('alice'), {
      target: { value: 'alice' },
    });
    clickNext(); // access
    clickNext(); // groups
    clickNext(); // tags
    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    clickNext();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByText('Tag keys cannot be empty or whitespace.').length).toBeGreaterThan(
      0,
    );
    expect(calls.some((call) => call.operation === 'CreateUser')).toBe(false);
  });
});
