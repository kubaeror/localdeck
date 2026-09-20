// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { PermissionsTab } from './PermissionsTab';

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

type Handler = (operation: string, input: Record<string, unknown>) => unknown;

/** Answers the S3 dispatcher, including `__error` payloads, recording calls. */
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

    const result = handler(operation, operationInput);
    if (typeof result === 'object' && result !== null && '__error' in result) {
      const error = (result as { __error: { code: string; message: string; statusCode: number } })
        .__error;
      return new Response(JSON.stringify({ error }), {
        status: error.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service: 's3', operation, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderPermissions(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter>
        <PermissionsTab bucket="alpha-bucket" />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('S3 PermissionsTab', () => {
  it('loads and saves a partial Block Public Access configuration unchanged', async () => {
    const calls = stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: false,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: false,
          },
        };
      }
      if (operation === 'GetBucketPolicy') {
        return { __error: { code: 'NoSuchBucketPolicy', message: 'none', statusCode: 404 } };
      }
      return {};
    });
    renderPermissions();

    const blockAcls = (await screen.findByRole('checkbox', {
      name: /BlockPublicAcls/,
    })) as HTMLInputElement;
    const ignoreAcls = screen.getByRole('checkbox', {
      name: /IgnorePublicAcls/,
    }) as HTMLInputElement;
    expect(blockAcls.checked).toBe(true);
    expect(ignoreAcls.checked).toBe(false);
    // A partial configuration reads as "partially blocked", not as all-off.
    expect(screen.getByText(/Partially blocked \(2 of 4 settings\)/)).toBeDefined();

    // Turn one setting on: Save must write exactly these four values, not the
    // all-blocked or all-default polarity the old master toggle produced.
    fireEvent.click(ignoreAcls);
    expect(ignoreAcls.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'PutPublicAccessBlock')).toBe(true);
    });
    const save = calls.find((call) => call.operation === 'PutPublicAccessBlock');
    expect(save?.input).toEqual({
      Bucket: 'alpha-bucket',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: false,
      },
    });
  });

  it('removes the explicit configuration through DeletePublicAccessBlock', async () => {
    const calls = stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        };
      }
      if (operation === 'GetBucketPolicy') {
        return { __error: { code: 'NoSuchBucketPolicy', message: 'none', statusCode: 404 } };
      }
      return {};
    });
    renderPermissions();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove configuration' }));

    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'DeletePublicAccessBlock')).toBe(true);
    });
    expect(await screen.findByText(/No explicit configuration exists/)).toBeDefined();
  });

  it('shows the all-off state after removing the configuration and never re-applies it', async () => {
    const calls = stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        };
      }
      if (operation === 'GetBucketPolicy') {
        return { __error: { code: 'NoSuchBucketPolicy', message: 'none', statusCode: 404 } };
      }
      return {};
    });
    renderPermissions();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove configuration' }));
    await waitFor(() => {
      expect(calls.some((call) => call.operation === 'DeletePublicAccessBlock')).toBe(true);
    });

    // No explicit configuration is 0 of 4 settings, not the console's
    // partially-blocked defaults that used to be shown here.
    expect(await screen.findByText('Not blocked')).toBeDefined();
    expect(screen.queryByText(/Partially blocked/)).toBeNull();
    expect(screen.getByText(/No explicit configuration exists/)).toBeDefined();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true);

    // Save is a no-op: the removed blocks cannot be silently written back.
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(calls.some((call) => call.operation === 'PutPublicAccessBlock')).toBe(false);
  });

  it('loads the example policy with the current bucket name', async () => {
    stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        };
      }
      if (operation === 'GetBucketPolicy') {
        return { __error: { code: 'NoSuchBucketPolicy', message: 'none', statusCode: 404 } };
      }
      return {};
    });
    const onPolicyDraftChange = vi.fn();
    render(
      <FlashbarProvider>
        <MemoryRouter>
          <PermissionsTab bucket="alpha-bucket" onPolicyDraftChange={onPolicyDraftChange} />
        </MemoryRouter>
      </FlashbarProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Use example policy' }));

    const draft = onPolicyDraftChange.mock.calls[0]?.[0];
    expect(typeof draft).toBe('string');
    expect(draft).toContain('arn:aws:s3:::alpha-bucket/*');
    expect(draft).not.toContain('my-bucket');
  });

  it('shows one section error without hiding the other permissions section', async () => {
    stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return { __error: { code: 'AccessDenied', message: 'no BPA for you', statusCode: 403 } };
      }
      return {};
    });
    renderPermissions();

    expect(
      await screen.findByText('Could not read the Block Public Access settings'),
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Bucket policy' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Access control list (ACL)' })).toBeDefined();
    expect(screen.queryByText('Could not load the bucket permissions')).toBeNull();
  });

  it('prefers a lifted settings draft over the loaded configuration', async () => {
    stubS3((operation) => {
      if (operation === 'GetPublicAccessBlock') {
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        };
      }
      if (operation === 'GetBucketPolicy') {
        return { __error: { code: 'NoSuchBucketPolicy', message: 'none', statusCode: 404 } };
      }
      return {};
    });
    render(
      <FlashbarProvider>
        <MemoryRouter>
          <PermissionsTab
            bucket="alpha-bucket"
            settingsDraft={{
              BlockPublicAcls: false,
              IgnorePublicAcls: false,
              BlockPublicPolicy: false,
              RestrictPublicBuckets: false,
            }}
            onSettingsDraftChange={vi.fn()}
          />
        </MemoryRouter>
      </FlashbarProvider>,
    );

    // The remounted tab fetched an all-blocked configuration, but the unsaved
    // draft (all off) is what the user still sees.
    const blockAcls = (await screen.findByRole('checkbox', {
      name: /BlockPublicAcls/,
    })) as HTMLInputElement;
    expect(blockAcls.checked).toBe(false);
    expect(screen.getByText('Not blocked')).toBeDefined();
  });
});
