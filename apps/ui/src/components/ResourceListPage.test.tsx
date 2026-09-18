// @vitest-environment jsdom
import type { Paginated } from '@localdeck/shared';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import type { TableProps } from '@cloudscape-design/components/table';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../lib/apiClient';
import { ResourceListPage } from './ResourceListPage';

interface Row {
  id: string;
  name: string;
  size: number;
}

const ROWS: readonly Row[] = [
  { id: 'bucket-b', name: 'bucket-b', size: 20 },
  { id: 'bucket-a', name: 'bucket-a', size: 10 },
];

const COLUMNS: readonly TableProps.ColumnDefinition<Row>[] = [
  { id: 'name', header: 'Name', sortingField: 'name', isRowHeader: true, cell: (row) => row.name },
  { id: 'size', header: 'Size', sortingField: 'size', cell: (row) => row.size },
];

interface HarnessProps {
  fetcher: (options: { nextToken?: string; signal?: AbortSignal }) => Promise<Paginated<Row>>;
  rowActions?: (row: Row) => ReactElement;
  bulkActions?: (selected: readonly Row[]) => ReactElement;
  headerActions?: ReactElement;
}

/** Owns the controlled filter text the way a service module would. */
function Harness({ fetcher, rowActions, bulkActions, headerActions }: HarnessProps): ReactElement {
  const [text, setText] = useState('');
  return (
    <MemoryRouter>
      <ResourceListPage<Row>
        title="Buckets"
        description="Objects live in buckets."
        breadcrumbs={[{ text: 'S3' }]}
        columns={COLUMNS}
        fetcher={fetcher}
        getRowId={(row) => row.id}
        filtering={{ text, onChange: setText, placeholder: 'Find buckets' }}
        {...(rowActions === undefined ? {} : { rowActions })}
        {...(bulkActions === undefined ? {} : { bulkActions })}
        {...(headerActions === undefined ? {} : { headerActions })}
      />
    </MemoryRouter>
  );
}

function singlePage(items: readonly Row[] = ROWS) {
  return vi.fn(async (): Promise<Paginated<Row>> => ({ items }));
}

describe('ResourceListPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('loads rows from the fetcher into a sortable table', async () => {
    render(<Harness fetcher={singlePage()} />);

    expect(await screen.findByText('bucket-a')).toBeDefined();
    expect(screen.getByText('bucket-b')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Buckets' })).toBeDefined();
    expect(screen.getByText('(2)')).toBeDefined();
  });

  it('sorts by a column when its header is clicked', async () => {
    render(<Harness fetcher={singlePage()} />);
    await screen.findByText('bucket-a');

    // Name ascending by default (the first sorting column), then toggle.
    const table = screen.getByRole('table');
    const names = (): string[] =>
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent ?? '');
    expect(names()).toEqual(['bucket-a', 'bucket-b']);

    fireEvent.click(within(table).getByRole('button', { name: /Name/ }));
    await waitFor(() => {
      expect(names()).toEqual(['bucket-b', 'bucket-a']);
    });
  });

  it('filters rows with the controlled filter text', async () => {
    render(<Harness fetcher={singlePage()} />);
    await screen.findByText('bucket-a');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter buckets' }), {
      target: { value: 'bucket-b' },
    });

    expect(screen.getByText('bucket-b')).toBeDefined();
    expect(screen.queryByText('bucket-a')).toBeNull();
    expect(screen.getByText('(1 of 2)')).toBeDefined();
  });

  it('renders per-row actions', async () => {
    const onAction = vi.fn();
    render(
      <Harness
        fetcher={singlePage()}
        rowActions={(row) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${row.name}`}
            items={[{ id: 'copy', text: 'Copy name' }]}
            onItemClick={() => onAction(row.name)}
          />
        )}
      />,
    );
    await screen.findByText('bucket-a');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for bucket-a' }));
    fireEvent.click(await screen.findByText('Copy name'));
    expect(onAction).toHaveBeenCalledWith('bucket-a');
  });

  it('offers bulk actions once rows are selected', async () => {
    render(
      <Harness
        fetcher={singlePage()}
        bulkActions={(selected) => <Button>Delete {selected.length}</Button>}
      />,
    );
    await screen.findByText('bucket-a');

    const checkboxes = screen.getAllByRole('checkbox');
    // The first checkbox selects everything on the page.
    fireEvent.click(checkboxes[1] as HTMLElement);

    expect(await screen.findByRole('button', { name: 'Delete 1' })).toBeDefined();
  });

  it('shows the empty state when the service returns nothing', async () => {
    render(<Harness fetcher={singlePage([])} />);

    expect(await screen.findByText('No buckets yet')).toBeDefined();
  });

  it('explains a 501 from the dispatcher and offers a retry', async () => {
    const fetcher = vi
      .fn<() => Promise<Paginated<Row>>>()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: 'SDK_PACKAGE_UNAVAILABLE',
          statusCode: 501,
          message: 'The LocalDeck api does not have @aws-sdk/client-sqs installed.',
        }),
      )
      .mockResolvedValue({ items: ROWS });

    render(<Harness fetcher={fetcher} />);

    expect(
      await screen.findByText('This service is not installed on the LocalDeck api'),
    ).toBeDefined();
    expect(screen.getByText(/@aws-sdk\/client-sqs/)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('bucket-a')).toBeDefined();
  });

  it('loads further pages through the continuation token', async () => {
    const fetcher = vi.fn(async (options: { nextToken?: string }): Promise<Paginated<Row>> =>
      options.nextToken === undefined
        ? { items: [ROWS[0] as Row], nextToken: 'page-2' }
        : { items: [ROWS[1] as Row] },
    );

    render(<Harness fetcher={fetcher} />);
    await screen.findByText('bucket-b');

    expect(screen.getByText('More results are available from the service.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('bucket-a')).toBeDefined();
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ nextToken: 'page-2' }));
  });

  it('aborts the in-flight fetch when unmounted', async () => {
    let captured: AbortSignal | undefined;
    const fetcher = vi.fn(async (options: { signal?: AbortSignal }) => {
      captured = options.signal;
      return { items: ROWS };
    });

    const { unmount } = render(<Harness fetcher={fetcher} />);
    await screen.findByText('bucket-a');
    unmount();

    expect(captured?.aborted).toBe(true);
  });
});
