import type { ApiError, Paginated } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences from '@cloudscape-design/components/collection-preferences';
import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { toApiError } from '../lib/apiClient';
import { readListPreferences, writeListPreferences } from '../lib/listPreferences';
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

/**
 * Visible-column choices for the preferences dialog. Accepts either
 * Cloudscape's grouped descriptor or the flat shorthand most modules use
 * (`{ title, options: [{ id, label }] }`).
 */
export interface ResourceListVisibleContentPreference {
  title: string;
  options: readonly (
    | CollectionPreferencesProps.VisibleContentOption
    | CollectionPreferencesProps.VisibleContentOptionsGroup
  )[];
}

function isVisibleContentGroup(
  entry:
    | CollectionPreferencesProps.VisibleContentOption
    | CollectionPreferencesProps.VisibleContentOptionsGroup,
): entry is CollectionPreferencesProps.VisibleContentOptionsGroup {
  return Array.isArray((entry as { options?: unknown }).options);
}

/** Normalizes either accepted shape into Cloudscape's grouped descriptor. */
function toVisibleContentPreference(
  preference: ResourceListVisibleContentPreference,
): CollectionPreferencesProps.VisibleContentPreference {
  const groups = preference.options.filter(isVisibleContentGroup);
  if (groups.length === preference.options.length) {
    return { title: preference.title, options: groups };
  }
  return {
    title: preference.title,
    options: [
      {
        label: preference.title,
        options: preference.options.filter(
          (entry): entry is CollectionPreferencesProps.VisibleContentOption =>
            !isVisibleContentGroup(entry),
        ),
      },
    ],
  };
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
  /**
   * Extra controls rendered next to the filter in the table header. Service
   * modules use it for view toggles that belong with the list.
   */
  filterExtras?: ReactNode;
  /** Page-level actions (a "Create" button); refresh is always added. */
  headerActions?: ReactNode;
  /** Rendered above the table: alerts, hints, long-running operations. */
  notifications?: ReactNode;
  /** Empty-state copy; the header actions are reused as its action. */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  pageSize?: number;
  /**
   * Enables the CollectionPreferences dialog and persists the confirmed page
   * size / visible columns under this key in localStorage. Omit it and the
   * list page behaves exactly as before (no preferences button).
   */
  preferencesId?: string;
  /** Page-size choices; omit to leave the page size fixed. */
  pageSizeOptions?: readonly CollectionPreferencesProps.PageSizeOption[];
  /**
   * Visible-column choices; option ids must match `columns[].id`. Both the
   * Cloudscape grouped shape and the flat `{ id, label }` shorthand work.
   */
  visibleContentPreference?: ResourceListVisibleContentPreference;
  /**
   * Bump to reload the list programmatically (after a delete, or while an
   * EC2/EKS action settles). After the initial load every reloadToken change
   * is a silent refresh: rows are swapped in place and phase, page and
   * selection are kept. The explicit Refresh button still resets all three.
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
  filterExtras,
  headerActions,
  notifications,
  emptyTitle,
  emptyDescription,
  pageSize = 10,
  preferencesId,
  pageSizeOptions,
  visibleContentPreference,
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
  const [storedPreferences, setStoredPreferences] =
    useState<CollectionPreferencesProps.Preferences>(() =>
      preferencesId === undefined ? {} : readListPreferences(preferencesId),
    );
  const inFlight = useRef<AbortController | null>(null);

  // Held in a ref so an inline fetcher does not restart the initial load.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const load = useCallback(
    async (
      options: { nextToken?: string; append?: boolean; silent?: boolean } = {},
    ): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const silent = options.silent === true;
      if (options.append === true) setLoadingMore(true);
      else if (!silent) setPhase('loading');

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
        // A silent refresh must not tear down rows the user is working with:
        // the error alert appears above the table, the phase stays as it was.
        if (!silent) setPhase('error');
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

  // Programmatic reloads (polling while a resource settles, post-delete)
  // refresh in place instead of resetting phase, selection and page.
  const reloadTokenRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadTokenRef.current === reloadToken) return;
    reloadTokenRef.current = reloadToken;
    void load({ silent: true });
  }, [load, reloadToken]);

  const filterText = filtering?.text ?? '';
  // Typing stays responsive; the (possibly large) filtering work follows the
  // deferred value.
  const deferredFilterText = useDeferredValue(filterText);
  const filterMatch = filtering?.match;
  const filtered = useMemo(() => {
    if (deferredFilterText.trim().length === 0) return items;
    const match = filterMatch ?? defaultMatch;
    return items.filter((item) => match(item, deferredFilterText));
  }, [deferredFilterText, filterMatch, items]);

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

  const preferencesEnabled =
    preferencesId !== undefined &&
    (pageSizeOptions !== undefined || visibleContentPreference !== undefined);
  const effectivePageSize =
    preferencesEnabled &&
    pageSizeOptions !== undefined &&
    storedPreferences.pageSize !== undefined &&
    pageSizeOptions.some((option) => option.value === storedPreferences.pageSize)
      ? storedPreferences.pageSize
      : pageSize;

  const normalizedVisibleContent = useMemo(
    () =>
      visibleContentPreference === undefined
        ? undefined
        : toVisibleContentPreference(visibleContentPreference),
    [visibleContentPreference],
  );

  const preferenceColumnIds = useMemo(() => {
    if (normalizedVisibleContent === undefined) return undefined;
    const ids = new Set<string>();
    for (const group of normalizedVisibleContent.options) {
      for (const option of group.options) ids.add(option.id);
    }
    return ids;
  }, [normalizedVisibleContent]);

  const tableColumns = useMemo<readonly TableProps.ColumnDefinition<T>[]>(() => {
    const base: readonly TableProps.ColumnDefinition<T>[] =
      rowActions === undefined
        ? columns
        : [
            ...columns,
            {
              id: 'localdeck-actions',
              header: 'Actions',
              minWidth: '140px',
              cell: (item: T) => rowActions(item),
            },
          ];
    const visible = storedPreferences.visibleContent;
    if (preferenceColumnIds === undefined || visible === undefined || visible.length === 0) {
      return base;
    }
    const visibleSet = new Set(visible);
    return base.filter(
      (column) =>
        column.id === undefined || !preferenceColumnIds.has(column.id) || visibleSet.has(column.id),
    );
  }, [columns, preferenceColumnIds, rowActions, storedPreferences.visibleContent]);

  const pagesCount = Math.max(1, Math.ceil(sorted.length / effectivePageSize));
  // The list can shrink between polls or after a delete; clamp instead of
  // showing an empty page.
  const pageIndex = Math.min(currentPageIndex, pagesCount);
  const visibleItems = sorted.slice(
    (pageIndex - 1) * effectivePageSize,
    pageIndex * effectivePageSize,
  );

  const selectionEnabled = bulkActions !== undefined;
  const counter = `(${sorted.length}${sorted.length === items.length ? '' : ` of ${items.length}`})`;
  const selectionAriaLabels: TableProps.AriaLabels<T> = {
    selectionGroupLabel: `${title} selection`,
    allItemsSelectionLabel: () => 'Select all items on this page',
    itemSelectionLabel: (_data: TableProps.SelectionState<T>, item: T) =>
      `Select ${getRowId(item)}`,
  };

  const filterControl =
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
    );

  const tableHeader = (
    <Header
      variant="h2"
      counter={counter}
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          {selectionEnabled && selectedItems.length > 0 && bulkActions !== undefined
            ? bulkActions(selectedItems)
            : null}
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

  const preferencesDialog = preferencesEnabled ? (
    <CollectionPreferences
      title="Preferences"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      {...(pageSizeOptions === undefined
        ? {}
        : { pageSizePreference: { title: 'Page size', options: pageSizeOptions } })}
      {...(normalizedVisibleContent === undefined
        ? {}
        : { visibleContentPreference: normalizedVisibleContent })}
      preferences={storedPreferences}
      onConfirm={({ detail }) => {
        const next: CollectionPreferencesProps.Preferences = {
          ...(detail.pageSize === undefined ? {} : { pageSize: detail.pageSize }),
          ...(detail.visibleContent === undefined ? {} : { visibleContent: detail.visibleContent }),
        };
        setStoredPreferences(next);
        if (preferencesId !== undefined) writeListPreferences(preferencesId, next);
        setCurrentPageIndex(1);
      }}
    />
  ) : undefined;

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
          preferences={preferencesDialog}
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
            filterControl === undefined ? undefined : filterExtras === undefined ? (
              filterControl
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>{filterControl}</div>
                {filterExtras}
              </div>
            )
          }
          header={
            nextToken === undefined ? (
              tableHeader
            ) : (
              <SpaceBetween size="xs">
                {tableHeader}
                <Box variant="small" color="text-body-secondary">
                  More results are available from the service.
                </Box>
              </SpaceBetween>
            )
          }
          pagination={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Pagination
                currentPageIndex={pageIndex}
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
