// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { PropertiesTab } from './PropertiesTab';

function renderProperties(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter>
        <PropertiesTab bucket="alpha-bucket" />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('S3 PropertiesTab', () => {
  beforeEach(() => {
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('blocks a tag save when a key is empty', async () => {
    renderProperties();
    await screen.findByRole('heading', { name: 'Bucket overview' });

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'orphan' } });

    expect(screen.getAllByText(/Tag keys cannot be empty or whitespace/).length).toBeGreaterThan(0);
    const saveButtons = screen.getAllByRole('button', { name: 'Save changes' });
    expect(saveButtons[1]?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(saveButtons[1] as HTMLElement);

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(dispatchedOperationCalls('s3', 'PutBucketTagging')).toBe(0);
    expect(dispatchedOperationCalls('s3', 'DeleteBucketTagging')).toBe(0);
  });

  it('keeps the loaded MFA delete value after a versioning save', async () => {
    stubApiFetch({
      operations: {
        's3/GetBucketVersioning': {
          service: 's3',
          operation: 'GetBucketVersioning',
          result: { Status: 'Enabled', MFADelete: 'Enabled' },
        },
      },
    });
    renderProperties();

    const mfaNote = await screen.findByText(/MFA delete can only be changed/);
    fireEvent.click(screen.getByRole('radio', { name: /Suspend versioning/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0] as HTMLElement);

    await waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'PutBucketVersioning')).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByText('Suspended')).toBeDefined();
    });
    // The save only changes Status; the loaded MFA delete value is preserved.
    expect(mfaNote.parentElement?.textContent).toContain('Enabled');
  });

  it('shows one section error instead of hiding every property read', async () => {
    stubApiFetch({
      operations: {
        's3/GetBucketVersioning': {
          error: { code: 'AccessDenied', message: 'no versioning for you', statusCode: 403 },
        },
        's3/GetBucketTagging': {
          service: 's3',
          operation: 'GetBucketTagging',
          result: { TagSet: [{ Key: 'env', Value: 'local' }] },
        },
      },
    });
    renderProperties();

    expect(await screen.findByText('Could not read the bucket versioning')).toBeDefined();
    expect(screen.getByDisplayValue('env')).toBeDefined();
    expect(screen.queryByText('Could not load the bucket properties')).toBeNull();
  });

  it('prefers lifted drafts over the freshly loaded values', async () => {
    stubApiFetch({
      operations: {
        's3/GetBucketVersioning': {
          service: 's3',
          operation: 'GetBucketVersioning',
          result: { Status: 'Suspended' },
        },
        's3/GetBucketTagging': {
          service: 's3',
          operation: 'GetBucketTagging',
          result: { TagSet: [{ Key: 'env', Value: 'loaded' }] },
        },
      },
    });
    render(
      <FlashbarProvider>
        <MemoryRouter>
          <PropertiesTab
            bucket="alpha-bucket"
            versioningDraft={true}
            onVersioningDraftChange={vi.fn()}
            tagsDraft={[{ Key: 'draft', Value: '1' }]}
            onTagsDraftChange={vi.fn()}
          />
        </MemoryRouter>
      </FlashbarProvider>,
    );

    // The draft survives the tab unmount/remount cycle and wins over the
    // values the remounted tab just fetched.
    expect(await screen.findByDisplayValue('draft')).toBeDefined();
    expect(
      (screen.getByRole('radio', { name: /Enable versioning/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
