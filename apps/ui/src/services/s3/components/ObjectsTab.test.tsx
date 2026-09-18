// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { ObjectsTab } from './ObjectsTab';

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

type Handler = (operation: string, input: Record<string, unknown>) => unknown;

function envelope(operation: string, result: unknown): Response {
  return new Response(JSON.stringify({ service: 's3', operation, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers the S3 dispatcher, recording every call. */
function stubS3(handler: Handler): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/s3\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });
    return envelope(operation, handler(operation, operationInput));
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderObjectsTab(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/s3/buckets/alpha-bucket']}>
        <ObjectsTab
          bucket="alpha-bucket"
          buckets={[{ name: 'alpha-bucket', raw: {} }]}
          bucketsLoading={false}
          bucketsError={null}
          onRefreshBuckets={() => {}}
        />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('S3 ObjectsTab', () => {
  it('deletes the folder marker and every nested marker', async () => {
    const calls = stubS3((operation, input) => {
      if (operation === 'ListObjectsV2') {
        if (input['Prefix'] === 'docs/' && input['Delimiter'] === undefined) {
          return {
            Contents: [
              { Key: 'docs/', Size: 0 },
              { Key: 'docs/nested/', Size: 0 },
              { Key: 'docs/nested/report.txt', Size: 12 },
            ],
          };
        }
        return { CommonPrefixes: [{ Prefix: 'docs/' }], Contents: [] };
      }
      if (operation === 'DeleteObjects') {
        return { Deleted: (input['Delete'] as { Objects: { Key: string }[] }).Objects };
      }
      return {};
    });

    renderObjectsTab();
    await screen.findByText('docs/');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for docs/' }));
    fireEvent.click(await screen.findByText('Delete folder'));

    const modal = (await screen.findAllByRole('dialog')).find(
      (dialog) => within(dialog).queryAllByText('Delete objects').length > 0,
    );
    if (modal === undefined) throw new Error('the delete confirmation modal is missing');
    fireEvent.change(within(modal).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'DeleteObjects')).toBe(true);
    });
    const deleteCall = calls.find((call) => call.operation === 'DeleteObjects');
    const keys = (
      deleteCall?.input['Delete'] as { Objects: { Key: string }[] } | undefined
    )?.Objects.map((entry) => entry.Key);
    expect(keys).toEqual(
      expect.arrayContaining(['docs/', 'docs/nested/', 'docs/nested/report.txt']),
    );
    // The folder list is refetched after the delete.
    await waitFor(() => {
      expect(calls.filter((call) => call.operation === 'ListObjectsV2').length).toBeGreaterThan(1);
    });
  });

  it('discards a load-more response that arrives after the prefix changed', async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const match = /\/api\/services\/s3\/([^/?]+)/.exec(url);
      const operation = match?.[1] ?? '';
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
      const operationInput = body.input ?? {};

      if (operation === 'ListObjectsV2') {
        if (operationInput['Prefix'] === 'a/') {
          return Promise.resolve(
            envelope(operation, { Contents: [{ Key: 'a/inside.txt', Size: 1 }] }),
          );
        }
        if (operationInput['ContinuationToken'] === 'page-2') {
          return new Promise<Response>((resolve) => {
            pending.push(resolve);
          });
        }
        return Promise.resolve(
          envelope(operation, {
            CommonPrefixes: [{ Prefix: 'a/' }],
            Contents: [],
            NextContinuationToken: 'page-2',
          }),
        );
      }
      return Promise.resolve(envelope(operation, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderObjectsTab();
    await screen.findByText('a/');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    // Switch folders while the load-more request is still in flight.
    fireEvent.click(screen.getByText('a/'));
    expect(await screen.findByText('inside.txt')).toBeDefined();

    pending[0]?.(envelope('ListObjectsV2', { Contents: [{ Key: 'stale.txt', Size: 1 }] }));
    // Flush the resolved promise's continuation before asserting.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(screen.queryByText('stale.txt')).toBeNull();
    expect(screen.getByText('inside.txt')).toBeDefined();
  });

  it('offers a disabled Show versions button naming ListObjectVersions', async () => {
    stubS3((operation) => (operation === 'ListObjectsV2' ? { Contents: [] } : {}));
    renderObjectsTab();

    const button = await screen.findByRole('button', { name: 'Show versions' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.closest('span')?.getAttribute('aria-label')).toContain('ListObjectVersions');
  });
});
