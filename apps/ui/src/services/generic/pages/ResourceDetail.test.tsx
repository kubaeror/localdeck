// @vitest-environment jsdom
import type { ServiceDescriptor } from '@localdeck/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { GenericResourceDetail } from './ResourceDetail';

const descriptor: ServiceDescriptor = {
  id: 'detail-test',
  displayName: 'Detail test',
  category: 'Database',
  sdkPackage: '@aws-sdk/client-test',
  iconKey: 'detail-test',
  operations: ['ListThings', 'DescribeThing', 'ListTagsForResource'],
  parityLevel: 'browser',
  summary: 'test',
  browser: {
    list: { operation: 'ListThings', resultPath: 'Items', idField: 'Id' },
    describe: { operation: 'DescribeThing', idParam: 'Id' },
    tags: { operation: 'ListTagsForResource', idParam: 'ResourceId', resultPath: 'Tags' },
  },
};

interface DispatchedCall {
  operation: string;
  input: Record<string, unknown>;
}

function operationResponse(result: unknown): Response {
  return new Response(JSON.stringify({ service: descriptor.id, operation: 'test', result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers the dispatcher per operation and records every call. */
function installDispatcher(
  handler: (operation: string, input: Record<string, unknown>) => Response | Promise<Response>,
): DispatchedCall[] {
  const calls: DispatchedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const match = /\/api\/services\/[^/]+\/([^/?]+)/.exec(String(request));
      const operation = match?.[1] ?? '';
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
      const input = body.input ?? {};
      calls.push({ operation, input });
      return handler(operation, input);
    }),
  );
  return calls;
}

/** Deep-link navigation between two resource ids, like two table rows. */
function DetailHarness(): JSX.Element {
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => {
          void navigate('/console/detail-test/resources/B');
        }}
      >
        open B
      </button>
      <Routes>
        <Route
          path="/console/detail-test/resources/:resourceId"
          element={<GenericResourceDetail descriptor={descriptor} />}
        />
      </Routes>
    </>
  );
}

describe('GenericResourceDetail', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads tags only for the resource the describe call returned', async () => {
    let resolveDescribeB: ((response: Response) => void) | undefined;
    const calls = installDispatcher((operation, input) => {
      if (operation === 'DescribeThing') {
        if (input['Id'] === 'B') {
          return new Promise<Response>((resolve) => {
            resolveDescribeB = resolve;
          });
        }
        return operationResponse({ Id: 'A', Name: 'resource A' });
      }
      if (operation === 'ListTagsForResource') {
        return operationResponse({ Tags: [{ Key: 'env', Value: String(input['ResourceId']) }] });
      }
      return operationResponse({});
    });

    render(
      <MemoryRouter initialEntries={['/console/detail-test/resources/A']}>
        <FlashbarProvider>
          <DetailHarness />
        </FlashbarProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'resource A' })).toBeDefined();
    await waitFor(() => {
      const tagsCalls = calls.filter((call) => call.operation === 'ListTagsForResource');
      expect(tagsCalls).toHaveLength(1);
      expect(tagsCalls[0]?.input['ResourceId']).toBe('A');
    });

    fireEvent.click(screen.getByRole('button', { name: 'open B' }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.operation === 'DescribeThing' && call.input['Id'] === 'B'),
      ).toHaveLength(1);
    });

    // B's describe is still pending: no tags request may be issued for B yet,
    // and the previous resource must not stay on screen.
    expect(calls.filter((call) => call.operation === 'ListTagsForResource')).toHaveLength(1);
    expect(await screen.findByRole('heading', { level: 1, name: 'B' })).toBeDefined();
    expect(screen.queryByRole('heading', { level: 1, name: 'resource A' })).toBeNull();

    await act(async () => {
      resolveDescribeB?.(operationResponse({ Id: 'B', Name: 'resource B' }));
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'resource B' })).toBeDefined();
    await waitFor(() => {
      const tagsCalls = calls.filter((call) => call.operation === 'ListTagsForResource');
      expect(tagsCalls).toHaveLength(2);
      expect(tagsCalls[1]?.input['ResourceId']).toBe('B');
    });
  });
});
