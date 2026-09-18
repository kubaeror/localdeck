// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { AttachPolicyModal } from './AttachPolicyModal';

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
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });
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

describe('IAM AttachPolicyModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the failed selection after a partial attach and refreshes the candidates', async () => {
    let attachCalls = 0;
    const calls = stubIam((operation) => {
      if (operation === 'ListAttachedUserPolicies') return { AttachedPolicies: [] };
      if (operation === 'ListPolicies') {
        return {
          Policies: [
            {
              PolicyName: 'policy-a',
              Arn: 'arn:aws:iam::000000000000:policy/policy-a',
              IsAttachable: true,
            },
            {
              PolicyName: 'policy-b',
              Arn: 'arn:aws:iam::000000000000:policy/policy-b',
              IsAttachable: true,
            },
          ],
        };
      }
      if (operation === 'AttachUserPolicy') {
        attachCalls += 1;
        // The second attach (policy-b) fails; the first succeeds.
        return attachCalls === 2
          ? { __error: { code: 'AccessDenied', message: 'denied', statusCode: 403 } }
          : {};
      }
      return {};
    });

    const onAttached = vi.fn();
    const onDismiss = vi.fn();
    render(
      <FlashbarProvider>
        <AttachPolicyModal
          entity="user"
          name="alice"
          onDismiss={onDismiss}
          onAttached={onAttached}
        />
      </FlashbarProvider>,
    );

    fireEvent.click(await screen.findByRole('checkbox', { name: /Select policy-a/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Select policy-b/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach policies' }));

    expect(await screen.findByText(/Some policies could not be attached/)).toBeDefined();
    expect(screen.getAllByText(/policy-b/).length).toBeGreaterThan(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onAttached).toHaveBeenCalled();

    // The succeeded policy is excluded from the picker; the failed one stays
    // selected so the user can retry.
    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: /Select policy-a/ })).toBeNull();
    });
    const failed = screen.getByRole('checkbox', { name: /Select policy-b/ }) as HTMLInputElement;
    expect(failed.checked).toBe(true);
    expect(calls.filter((call) => call.operation === 'AttachUserPolicy')).toHaveLength(2);
  });
});
