// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { ListPage } from './List';

const S3 = ((): ServiceDescriptor => {
  const service = findService('s3');
  if (service === undefined) throw new Error('s3 must be registered');
  return service;
})();

function renderList(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/s3']}>
        <ListPage descriptor={S3} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('S3 ListPage', () => {
  beforeEach(() => {
    stubApiFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders buckets with their creation dates and filters by name', async () => {
    stubApiFetch({
      operations: {
        's3/ListBuckets': {
          service: 's3',
          operation: 'ListBuckets',
          result: {
            Buckets: [
              { Name: 'alpha-bucket', CreationDate: '2026-01-02T03:04:05.000Z' },
              { Name: 'beta-bucket', CreationDate: '2026-02-03T04:05:06.000Z' },
            ],
          },
        },
      },
    });
    renderList();

    expect(await screen.findByRole('heading', { level: 1, name: 'Buckets' })).toBeDefined();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('alpha-bucket')).toBeDefined();
    expect(within(table).getByText('January 2, 2026, 3:04:05 AM (UTC)')).toBeDefined();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter buckets' }), {
      target: { value: 'beta' },
    });
    expect(screen.getByText('beta-bucket')).toBeDefined();
    expect(screen.queryByText('alpha-bucket')).toBeNull();
  });

  it('shows the console empty state with a create action', async () => {
    stubApiFetch({
      operations: {
        's3/ListBuckets': { service: 's3', operation: 'ListBuckets', result: { Buckets: [] } },
      },
    });
    renderList();

    expect(await screen.findByText('No buckets')).toBeDefined();
    expect(screen.getByText(/Buckets are containers for objects/)).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Create bucket' }).length).toBeGreaterThan(0);
  });

  it('deletes selected buckets after the typed confirmation', async () => {
    renderList();
    await screen.findByText('alpha-bucket');

    fireEvent.click(screen.getAllByRole('checkbox')[1] as HTMLElement);
    // The header swaps the Create button for the bulk-actions dropdown.
    fireEvent.click(await screen.findByRole('button', { name: 'Bulk actions' }));
    fireEvent.click(await screen.findByText('Delete'));

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getAllByText('alpha-bucket').length).toBeGreaterThan(0);

    // A single subject asks for its exact name (the console pattern).
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alpha-bucket' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Delete bucket' }));

    await vi.waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'DeleteBucket')).toBe(1);
    });
    // The modal closes, the header returns to the create action and the list
    // refetches (the flashbar itself is rendered by the app shell).
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      (await screen.findAllByRole('button', { name: 'Create bucket' })).length,
    ).toBeGreaterThan(0);
    await vi.waitFor(() => {
      expect(dispatchedOperationCalls('s3', 'ListBuckets')).toBeGreaterThan(1);
    });
  });
});
