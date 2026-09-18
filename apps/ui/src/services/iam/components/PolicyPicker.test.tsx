// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PolicyPicker } from './PolicyPicker';

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

function stubIam(handler: (input: Record<string, unknown>) => unknown): Call[] {
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
      JSON.stringify({ service: 'iam', operation, result: handler(operationInput) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function policy(index: number) {
  return {
    PolicyName: `policy-${String(index).padStart(2, '0')}`,
    Arn: `arn:aws:iam::000000000000:policy/policy-${index}`,
    IsAttachable: true,
  };
}

describe('IAM PolicyPicker', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads the AWS-managed continuation page with the returned Marker', async () => {
    const calls = stubIam((input) => {
      if (input.Marker === undefined) {
        return {
          Policies: Array.from({ length: 10 }, (_value, index) => policy(index + 1)),
          IsTruncated: true,
          Marker: 'page-2',
        };
      }
      return { Policies: [policy(11)], IsTruncated: false };
    });

    render(<PolicyPicker selectedArns={[]} onChange={() => undefined} />);

    expect(await screen.findByText('policy-01')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    // The page was appended: 11 items are loaded but page 1 is still visible.
    await screen.findByText(/11 policies available/);
    const pageCalls = calls.filter((call) => call.operation === 'ListPolicies');
    expect(pageCalls).toHaveLength(2);
    expect(pageCalls[1]?.input).toMatchObject({ Marker: 'page-2', MaxItems: 100 });

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText('policy-11')).toBeDefined();
  });

  it('never selects a policy LocalStack marks IsAttachable=false', async () => {
    stubIam(() => ({
      Policies: [
        {
          PolicyName: 'service-linked',
          Arn: 'arn:aws:iam::000000000000:policy/service-linked',
          IsAttachable: false,
        },
      ],
    }));

    const onChange = vi.fn();
    render(<PolicyPicker selectedArns={[]} onChange={onChange} />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /Select service-linked/ }));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(await screen.findByText(/marked IsAttachable=false/)).toBeDefined();
  });

  it('clamps the page index when the filtered candidates shrink', async () => {
    stubIam((input) => {
      if (input.Scope === 'AWS') return { Policies: [] };
      return {
        Policies: Array.from({ length: 11 }, (_value, index) => policy(index + 1)),
        IsTruncated: false,
      };
    });

    render(<PolicyPicker selectedArns={[]} onChange={() => undefined} />);

    expect(await screen.findByText('policy-01')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText('policy-11')).toBeDefined();

    // The filter shrinks the result set to one page; the derived page index
    // falls back to page 1 instead of rendering an empty out-of-range page.
    fireEvent.change(screen.getByLabelText('Filter policies'), {
      target: { value: 'policy-03' },
    });

    await waitFor(() => {
      expect(screen.getByText('policy-03')).toBeDefined();
    });
    expect(screen.queryByText('policy-11')).toBeNull();
  });
});
