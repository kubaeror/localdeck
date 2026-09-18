// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import Flashbar from '@cloudscape-design/components/flashbar';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { CreatePage } from './Create';

const S3 = ((): ServiceDescriptor => {
  const service = findService('s3');
  if (service === undefined) throw new Error('s3 must be registered');
  return service;
})();

/** Renders the app-wide flashbar so page tests can assert its messages. */
function FlashbarProbe(): ReactElement {
  const { items } = useFlashbar();
  return <Flashbar items={[...items]} />;
}

function renderCreate(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/s3/create']}>
        <Routes>
          <Route path="/console/s3/create" element={<CreatePage descriptor={S3} />} />
          <Route path="/console/s3/buckets/:bucketName" element={<div>Bucket detail stub</div>} />
        </Routes>
        <FlashbarProbe />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

function fillNameAndAdvanceToTags(): void {
  fireEvent.change(screen.getByPlaceholderText('my-bucket'), {
    target: { value: 'my-new-bucket' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

describe('S3 CreatePage', () => {
  beforeEach(() => {
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('blocks the Tags step while a key is empty', async () => {
    renderCreate();
    fillNameAndAdvanceToTags();

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'orphan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      (await screen.findAllByText(/Tag keys cannot be empty or whitespace/)).length,
    ).toBeGreaterThan(0);
    // The wizard stayed on Tags instead of advancing to Block Public Access.
    expect(screen.queryByText('Block all public access')).toBeNull();
  });

  it('navigates to the half-configured bucket and explains what failed', async () => {
    stubApiFetch({
      operations: {
        's3/PutPublicAccessBlock': {
          error: { code: 'AccessDenied', message: 'Access Denied', statusCode: 403 },
        },
      },
    });
    renderCreate();
    fillNameAndAdvanceToTags();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create bucket' }));

    // The bucket exists, so the wizard sends the user to it.
    expect(await screen.findByText('Bucket detail stub')).toBeDefined();
    expect(await screen.findByText('Bucket created, but a setting failed')).toBeDefined();
    expect(
      screen.getByText(
        /Bucket "my-new-bucket" was created, but the Block Public Access settings failed/,
      ),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'View bucket' })).toBeDefined();
    await waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'PutPublicAccessBlock')).toBe(1);
    });
  });
});
