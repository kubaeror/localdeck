// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { AccessKeysPanel } from './AccessKeysPanel';

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

function renderPanel(): void {
  render(
    <FlashbarProvider>
      <AccessKeysPanel userName="alice" />
    </FlashbarProvider>,
  );
}

describe('IAM AccessKeysPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the secret exactly once and never re-lists it', async () => {
    const calls = stubIam((operation) => {
      if (operation === 'ListAccessKeys') {
        return {
          AccessKeyMetadata: [
            { AccessKeyId: 'AKIA1', Status: 'Active', CreateDate: '2026-01-01T00:00:00.000Z' },
          ],
        };
      }
      if (operation === 'CreateAccessKey') {
        return {
          AccessKey: {
            AccessKeyId: 'AKIA2',
            SecretAccessKey: 's3cret-value',
            Status: 'Active',
            UserName: 'alice',
          },
        };
      }
      return {};
    });
    renderPanel();

    expect(await screen.findByText('AKIA1')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Create access key' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create access key' }));

    expect(await screen.findByText('s3cret-value')).toBeDefined();
    expect(calls.filter((call) => call.operation === 'CreateAccessKey')).toHaveLength(1);

    // Closing the ceremony never shows the secret again: the list read returns
    // metadata only and the panel re-renders the table.
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'I have copied the secret access key' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByText('s3cret-value')).toBeNull();
    });
    expect(screen.getByText('AKIA1')).toBeDefined();
  });

  it('requires the copied-secret acknowledgment before the ceremony can close', async () => {
    stubIam((operation) =>
      operation === 'CreateAccessKey'
        ? {
            AccessKey: {
              AccessKeyId: 'AKIA2',
              SecretAccessKey: 's3cret-value',
              Status: 'Active',
              UserName: 'alice',
            },
          }
        : { AccessKeyMetadata: [] },
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Create access key' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create access key' }));
    await screen.findByText('s3cret-value');

    // Done is disabled and the X/close path is ignored until the box is ticked.
    const done = within(dialog).getByRole('button', { name: 'Done' });
    expect(done.hasAttribute('disabled')).toBe(true);
    fireEvent.click(done);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close create access key' }));

    expect(screen.getByText('s3cret-value')).toBeDefined();

    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'I have copied the secret access key' }),
    );
    fireEvent.click(done);
    await waitFor(() => {
      expect(screen.queryByText('s3cret-value')).toBeNull();
    });
  });

  it('disables creation at the two-key limit with an explanation', async () => {
    stubIam((operation) => {
      if (operation === 'ListAccessKeys') {
        return {
          AccessKeyMetadata: [
            { AccessKeyId: 'AKIA1', Status: 'Active' },
            { AccessKeyId: 'AKIA2', Status: 'Inactive' },
          ],
        };
      }
      return {};
    });
    renderPanel();

    expect(await screen.findByText(/maximum of two access keys/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create access key' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});
