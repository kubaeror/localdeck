// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { TagsTab } from './TagsTab';

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

function renderTab(): void {
  render(
    <FlashbarProvider>
      <TagsTab entity="user" name="alice" />
    </FlashbarProvider>,
  );
}

describe('IAM TagsTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('saves only the changed keys and the removed keys', async () => {
    const calls = stubIam((operation) =>
      operation === 'ListUserTags'
        ? {
            Tags: [
              { Key: 'keep', Value: '1' },
              { Key: 'drop', Value: 'x' },
              { Key: 'edit', Value: 'old' },
            ],
          }
        : {},
    );
    renderTab();

    const editValue = await screen.findByDisplayValue('old');
    fireEvent.change(editValue, { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag drop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'TagUser')).toBe(true);
    });
    const tagCall = calls.find((call) => call.operation === 'TagUser');
    expect(tagCall?.input).toEqual({
      UserName: 'alice',
      Tags: [{ Key: 'edit', Value: 'new' }],
    });
    const untagCall = calls.find((call) => call.operation === 'UntagUser');
    expect(untagCall?.input).toEqual({ UserName: 'alice', TagKeys: ['drop'] });
  });

  it('blocks saving a tag row without a key', async () => {
    stubIam(() => ({ Tags: [] }));
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Add new tag' }));
    const errors = screen.getAllByText('Tag keys cannot be empty or whitespace.');
    expect(errors.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
