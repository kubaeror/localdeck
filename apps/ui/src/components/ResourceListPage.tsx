import type { ApiError, Paginated } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { toApiError } from '../lib/apiClient';
import { ConsoleBreadcrumbs, type ConsoleBreadcrumb } from './ConsoleBreadcrumbs';
import { EmptyState } from './EmptyState';

/** Filter contract for a resource list: controlled text plus a predicate. */
export interface ResourceListFiltering<T> {
  text: string;
  onChange: (text: string) => void;
  placeholder?: string;
  /** Defaults to a case-insensitive match on the row's string properties. */
  match?: (item: T, text: string) => boolean;
}

export interface ResourceListFetcherOptions {
  /** Continuation token from the previous page, when one was returned. */
  nextToken?: string;
  signal?: AbortSignal;
}

export interface ResourceListPageProps<T> {
  /** Page title (h1), table header and empty-state subject. */
  title: string;
  description?: ReactNode;
  breadcrumbs: readonly ConsoleBreadcrumb[];
  columns: readonly TableProps.ColumnDefinition<T>[];
  /** Fetches one page of resources; called on mount, refresh and "load more". */
  fetcher: (options: ResourceListFetcherOptions) => Promise<Paginated<T>>;
  /** Stable row identity, used for keys, selection and `trackBy`. */
  getRowId: (item: T) => string;
  /** Per-row actions, rendered in a trailing column. */
  rowActions?: (item: T) => ReactNode;
  /** Selection actions; providing this enables row selection. */
  bulkActions?: (selectedItems: readonly T[]) => ReactNode;
  filtering?: ResourceListFiltering<T>;
  /** Page-level actions (a "Create" button); refresh is always added. */
  headerActions?: ReactNode;
  /** Rendered above the table: alerts, hints, long-running operations. */
  notifications?: ReactNode;
  /** Empty-state copy; the header actions are reused as its action. */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  pageSize?: number;
  /**
   * Bump to reload the list programmatically (after a delete, for example).
   * The initial load is unaffected.
   */
  reloadToken?: number;
  /** Sorting value for a column's `sortingField`; defaults to that property. */
  getSortingValue?: (item: T, field: string) => string | number | undefined;
}

function defaultMatch(item: unknown, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (typeof item === 'object' && item !== null) {
    return Object.values(item as Record<string, unknown>).some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(needle),
    );
  }
  return String(item).toLowerCase().includes(needle);
}

function defaultSortingValue(item: unknown, field: string): string | number | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const value = (item as Record<string, unknown>)[field];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * The console's list page: breadcrumbs, header, controlled filter, selection
 * with bulk actions, per-row actions, client-side sorting/pagination, "load
 * more" for services that return continuation tokens, and a shared empty
 * state. Service modules compose it instead of writing their own table.
 */
export function ResourceListPage<T>({
  title,
  description,
  breadcrumbs,
  columns,
  fetcher,
  getRowId,
  rowActions,
  bulkActions,
  filtering,
  headerActions,
  notifications,
  emptyTitle,
  emptyDescription,
  pageSize = 10,
  reloadToken = 0,
  getSortingValue = defaultSortingValue,
}: ResourceListPageProps<T>): ReactElement {
  const [items, setItems] = useState<readonly T[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedItems, setSelectedItems] = useState<readonly T[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<T>>(
    columns[0]?.sortingField === undefined
      ? { sortingField: 'id' }
      : { sortingField: columns[0].sortingField },
  );
  const [isSortingDescending, setIsSortingDescending] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  // Held in a ref so an inline fetcher does not restart the initial load.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(
    async (options: { nextToken?: string; append?: boolean } = {}): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (options.append === true) setLoadingMore(true);
      else setPhase('loading');

      try {
        const page = await fetcherRef.current({
          ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems((previous) =>
          options.append === true ? [...previous, ...page.items] : page.items,
        );
        setNextToken(page.nextToken);
        setError(null);
        setPhase('ready');
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toApiError(caught));
        setPhase('error');
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    // The initial load must show the loading state; every state update after
    // that happens in the fetch continuation, not during the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  // Programmatic reloads (after a delete) reuse the same load path.
  const reloadTokenRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadTokenRef.current === reloadToken) return;
    reloadTokenRef.current = reloadToken;
    setSelectedItems([]);
    setCurrentPageIndex(1);
    void load();
  }, [load, reloadToken]);

  const filtered = useMemo(() => {
    if (filtering === undefined || filtering.text.trim().length === 0) return items;
    const match = filtering.match ?? defaultMatch;
    return items.filter((item) => match(item, filtering.text));
  }, [filtering, items]);

  const sorted = useMemo(() => {
    const field = sortingColumn.sortingField;
    if (field === undefined) return filtered;
    const direction = isSortingDescending ? -1 : 1;
    return [...filtered].sort((left, right) => {
      const a = getSortingValue(left, field);
      const b = getSortingValue(right, field);
      if (a === undefined && b === undefined) return 0;
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
      return String(a).localeCompare(String(b), 'en') * direction;
    });
  }, [filtered, getSortingValue, isSortingDescending, sortingColumn]);

  const pagesCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const visibleItems = sorted.slice((currentPageIndex - 1) * pageSize, currentPageIndex * pageSize);

  const tableColumns = useMemo<readonly TableProps.ColumnDefinition<T>[]>(() => {
    if (rowActions === undefined) return columns;
    return [
      ...columns,
      {
        id: 'localdeck-actions',
        header: 'Actions',
        minWidth: '140px',
        cell: (item: T) => rowActions(item),
      },
    ];
  }, [columns, rowActions]);

  const selectionEnabled = bulkActions !== undefined;
  const counter = `(${sorted.length}${sorted.length === items.length ? '' : ` of ${items.length}`})`;
  const selectionAriaLabels: TableProps.AriaLabels<T> = {
    selectionGroupLabel: `${title} selection`,
    allItemsSelectionLabel: () => 'Select all items on this page',
    itemSelectionLabel: (_data: TableProps.SelectionState<T>, item: T) =>
      `Select ${getRowId(item)}`,
  };

  const header = (
    <Header
      variant="h2"
      counter={counter}
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          {selectionEnabled && selectedItems.length > 0 && bulkActions !== undefined
            ? bulkActions(selectedItems)
            : headerActions}
          <Button
            iconName="refresh"
            ariaLabel={`Refresh ${title}`}
            loading={phase === 'loading'}
            onClick={() => {
              setSelectedItems([]);
              setCurrentPageIndex(1);
              void load();
            }}
          />
        </SpaceBetween>
      }
    >
      {title}
    </Header>
  );

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={breadcrumbs} />}
      header={
        <Header variant="h1" description={description} actions={headerActions}>
          {title}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {notifications}

        {error === null ? null : (
          <Alert
            type="error"
            header={
              error.statusCode === 501
                ? 'This service is not installed on the LocalDeck api'
                : 'Could not load resources'
            }
            action={
              <Button
                onClick={() => {
                  void load();
                }}
              >
                Retry
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        <Table<T>
          variant="container"
          stickyHeader
          loading={phase === 'loading'}
          loadingText={`Loading ${title.toLowerCase()}`}
          items={visibleItems}
          columnDefinitions={tableColumns}
          trackBy={getRowId}
          {...(selectionEnabled
            ? {
                selectionType: 'multi' as const,
                selectedItems,
                ariaLabels: selectionAriaLabels,
                onSelectionChange: ({ detail }) => {
                  setSelectedItems(detail.selectedItems);
                },
              }
            : {})}
          sortingColumn={sortingColumn}
          sortingDescending={isSortingDescending}
          onSortingChange={({ detail }) => {
            setSortingColumn(detail.sortingColumn);
            setIsSortingDescending(detail.isDescending ?? false);
            setCurrentPageIndex(1);
          }}
          filter={
            filtering === undefined ? undefined : (
              <TextFilter
                filteringText={filtering.text}
                filteringPlaceholder={filtering.placeholder ?? `Find ${title.toLowerCase()}`}
                filteringAriaLabel={`Filter ${title.toLowerCase()}`}
                countText={`${sorted.length} match${sorted.length === 1 ? '' : 'es'}`}
                onChange={({ detail }) => {
                  filtering.onChange(detail.filteringText);
                  setCurrentPageIndex(1);
                }}
              />
            )
          }
          header={
            nextToken === undefined ? (
              header
            ) : (
              <SpaceBetween size="xs">
                {header}
                <Box variant="small" color="text-body-secondary">
                  More results are available from the service.
                </Box>
              </SpaceBetween>
            )
          }
          pagination={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Pagination
                currentPageIndex={currentPageIndex}
                pagesCount={pagesCount}
                onChange={({ detail }) => {
                  setCurrentPageIndex(detail.currentPageIndex);
                }}
              />
              {nextToken === undefined ? null : (
                <Button
                  loading={loadingMore}
                  onClick={() => {
                    void load({ nextToken, append: true });
                  }}
                >
                  Load more
                </Button>
              )}
            </SpaceBetween>
          }
          empty={
            <EmptyState
              title={emptyTitle ?? `No ${title.toLowerCase()} yet`}
              description={
                emptyDescription ??
                'Nothing was returned for this service. Create a resource to see it here.'
              }
              action={headerActions}
            />
          }
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
