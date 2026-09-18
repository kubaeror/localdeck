// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { PolicyCreatePage } from './PolicyCreate';

// The Ace bundle is never loaded in tests: the editor falls back to a textarea.
vi.mock('../../../lib/aceJsonBundle', () => ({
  loadAceJsonBundle: (): Promise<never> =>
    Promise.reject(new Error('ace is not available in tests')),
}));

const IAM = ((): ServiceDescriptor => {
  const service = findService('iam');
  if (service === undefined) throw new Error('iam must be registered');
  return service;
})();

const FULL_ADMIN_DOCUMENT = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }],
  },
  null,
  2,
);

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

/** Answers the dispatcher, turning `__error` results into api error responses. */
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

    const result = handler(operation);
    if (typeof result === 'object' && result !== null && '__error' in result) {
      const error = (result as { __error: { code: string; message: string; statusCode: number } })
        .__error;
      return new Response(JSON.stringify({ error }), {
        status: error.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service: 'iam', operation, result }), {
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
      <MemoryRouter initialEntries={['/console/iam/policies/create']}>
        <Routes>
          <Route
            path="/console/iam/policies/create"
            element={<PolicyCreatePage descriptor={IAM} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('IAM PolicyCreatePage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('closes the full-admin confirmation on a failed create so the error is visible', async () => {
    const calls = stubIam((operation) =>
      operation === 'CreatePolicy'
        ? { __error: { code: 'MalformedPolicyDocument', message: 'rejected', statusCode: 400 } }
        : {},
    );
    renderWizard();

    fireEvent.click(await screen.findByRole('radio', { name: /JSON/ }));
    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: FULL_ADMIN_DOCUMENT },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(await screen.findByPlaceholderText('s3-read-only'), {
      target: { value: 'full-admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create policy' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save anyway' }));

    // The modal closes so the wizard alert is visible, and only one create ran.
    // Cloudscape keeps a hidden Modal in the DOM and jsdom does not apply the
    // `awsui_hidden` CSS, so the closed state is detected by that class.
    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"][data-analytics-modal-id]');
      expect(dialog?.className.includes('awsui_hidden')).toBe(true);
    });
    expect(await screen.findByText(/LocalStack rejected the policy document/)).toBeDefined();
    expect(calls.filter((call) => call.operation === 'CreatePolicy')).toHaveLength(1);
  });
});
