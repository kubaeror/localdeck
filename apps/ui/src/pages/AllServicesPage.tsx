import {
  resolveServiceStatus,
  type ServiceDescriptor,
  type ServiceParityLevel,
  type EmulatorServiceState,
} from '@localdeck/shared';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences from '@cloudscape-design/components/collection-preferences';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../components/ConsoleBreadcrumbs';
import { InfoTooltip } from '../components/InfoTooltip';
import { ServiceIcon } from '../components/ServiceIcon';
import { StatusBadge } from '../components/StatusBadge';
import { GLOBAL_SEARCH_SHORTCUT_LABEL } from '../contexts/global-search-context';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { useServiceCatalog } from '../hooks/useServiceCatalog';
import {
  NOT_INSTALLED_SHORT_LABEL,
  NOT_INSTALLED_TOOLTIP,
  notReportedLabel,
  UNVERIFIED_SERVICE_LABEL,
} from '../lib/copy';
import { PARITY_COLORS, PARITY_LABELS } from '../lib/parity';
import { searchServices } from '../lib/serviceSearch';
import { serviceConsolePath } from '../services/paths';

interface ServiceRow {
  service: ServiceDescriptor;
  status: EmulatorServiceState | undefined;
  parity: ServiceParityLevel;
}

const PAGE_SIZE_OPTIONS = [
  { value: 25, label: '25 services' },
  { value: 50, label: '50 services' },
  { value: 100, label: '100 services' },
];

const ALL_COLUMN_IDS = ['service', 'category', 'status', 'parity', 'operations'] as const;
type ColumnId = (typeof ALL_COLUMN_IDS)[number];

type SortingField = 'displayName' | 'category' | 'status' | 'parity';

function sortingValue(row: ServiceRow, field: SortingField): string {
  switch (field) {
    case 'displayName':
      return row.service.displayName;
    case 'category':
      return row.service.category;
    case 'status':
      return row.status ?? 'zz-not-emulated';
    case 'parity':
      return row.parity;
    default:
      return row.service.displayName;
  }
}

/**
 * The full registry, with the live LocalStack status of every entry. This is
 * where "what can LocalDeck do with this stack?" is answered.
 */
export function AllServicesPage(): ReactElement {
  const navigate = useNavigate();
  const search = useGlobalSearch();
  const status = useEmulatorStatus();
  const catalog = useServiceCatalog();

  const [filteringText, setFilteringText] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [currentPageIndex, setCurrentPageIndex] = useState(1);
  const [visibleColumns, setVisibleColumns] = useState<readonly ColumnId[]>(ALL_COLUMN_IDS);
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<ServiceRow>>({
    sortingField: 'displayName',
  });
  const [isSortingDescending, setIsSortingDescending] = useState(false);

  const reported = useMemo(() => status.health?.emulator.services ?? {}, [status.health]);
  const provider = status.health?.provider.provider ?? 'generic';
  const providerLabel = status.health?.provider.providerLabel ?? 'the emulator';
  const hasServiceInventory = status.health?.emulator.hasServiceInventory ?? false;
  const loading = status.health === null && status.phase === 'loading';

  const rows = useMemo<readonly ServiceRow[]>(() => {
    const query = filteringText.trim();
    const descriptors =
      query.length === 0
        ? catalog.services
        : searchServices(query, catalog.services, catalog.services.length).map(
            (match) => match.service,
          );

    const collected: ServiceRow[] = descriptors.map((service) => ({
      service,
      status: resolveServiceStatus(service, reported, provider),
      parity: service.parityLevel,
    }));

    const field = (sortingColumn.sortingField ?? 'displayName') as SortingField;
    const direction = isSortingDescending ? -1 : 1;
    return collected.sort((left, right) => {
      const compared = sortingValue(left, field).localeCompare(sortingValue(right, field), 'en');
      return compared === 0
        ? left.service.displayName.localeCompare(right.service.displayName, 'en')
        : compared * direction;
    });
  }, [catalog.services, filteringText, isSortingDescending, provider, reported, sortingColumn]);

  const pagesCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // The registry can shrink between polls; clamp instead of showing an empty
  // page with a counter that no longer exists.
  const pageIndex = Math.min(currentPageIndex, pagesCount);
  const visibleRows = rows.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);

  const columnDefinitions: TableProps.ColumnDefinition<ServiceRow>[] = [
    {
      id: 'service',
      header: 'Service',
      sortingField: 'displayName',
      isRowHeader: true,
      cell: (row) => (
        <SpaceBetween direction="horizontal" size="xs">
          <ServiceIcon iconKey={row.service.iconKey} category={row.service.category} size="small" />
          <Link
            href={serviceConsolePath(row.service.id)}
            onFollow={(event) => {
              event.preventDefault();
              void navigate(serviceConsolePath(row.service.id));
            }}
          >
            {row.service.displayName}
          </Link>
        </SpaceBetween>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      sortingField: 'category',
      cell: (row) => row.service.category,
    },
    {
      id: 'status',
      header: `${providerLabel} status`,
      sortingField: 'status',
      cell: (row) =>
        row.status === undefined ? (
          <Badge color="grey">
            {hasServiceInventory ? notReportedLabel(providerLabel) : UNVERIFIED_SERVICE_LABEL}
          </Badge>
        ) : (
          <StatusBadge status={row.status} />
        ),
    },
    {
      id: 'parity',
      header: 'LocalDeck support',
      sortingField: 'parity',
      cell: (row) => (
        <SpaceBetween direction="horizontal" size="xs">
          <Badge color={PARITY_COLORS[row.parity]}>{PARITY_LABELS[row.parity]}</Badge>
          {row.service.available === false ? (
            <InfoTooltip content={NOT_INSTALLED_TOOLTIP}>
              <Badge color="grey">{NOT_INSTALLED_SHORT_LABEL}</Badge>
            </InfoTooltip>
          ) : null}
        </SpaceBetween>
      ),
    },
    {
      id: 'operations',
      header: 'Operations',
      cell: (row) => `${row.service.operations.length} whitelisted`,
    },
  ];

  return (
    <ContentLayout
      breadcrumbs={<ConsoleBreadcrumbs items={[{ text: 'All services' }]} />}
      header={
        <Header
          variant="h1"
          description={
            catalog.source === 'api'
              ? `The registry served by GET /api/services, matched against the live ${providerLabel} health document.`
              : `The registry bundled with the ui, matched against the live ${providerLabel} health document.`
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="search"
                onClick={() => {
                  search.open();
                }}
              >
                Search
              </Button>
              <Button
                iconName="refresh"
                loading={status.phase === 'loading'}
                onClick={() => {
                  status.refresh();
                }}
              >
                Refresh status
              </Button>
            </SpaceBetween>
          }
        >
          All services
        </Header>
      }
    >
      <Table<ServiceRow>
        variant="container"
        stickyHeader
        items={visibleRows}
        columnDefinitions={columnDefinitions.filter(
          (column) => column.id !== undefined && visibleColumns.includes(column.id as ColumnId),
        )}
        sortingColumn={sortingColumn}
        sortingDescending={isSortingDescending}
        onSortingChange={({ detail }) => {
          setSortingColumn(detail.sortingColumn);
          setIsSortingDescending(detail.isDescending ?? false);
          setCurrentPageIndex(1);
        }}
        filter={
          <TextFilter
            filteringText={filteringText}
            filteringPlaceholder="Find a service by name, id, category or operation"
            filteringAriaLabel="Filter the service registry"
            countText={`${rows.length} match${rows.length === 1 ? '' : 'es'}`}
            onChange={({ detail }) => {
              setFilteringText(detail.filteringText);
              setCurrentPageIndex(1);
            }}
          />
        }
        header={
          <Header
            variant="h2"
            counter={`(${rows.length})`}
            description="Every service LocalDeck knows about, including ones this stack does not emulate."
          >
            Service registry
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={pageIndex}
            pagesCount={pagesCount}
            onChange={({ detail }) => {
              setCurrentPageIndex(detail.currentPageIndex);
            }}
          />
        }
        preferences={
          <CollectionPreferences
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            pageSizePreference={{ title: 'Page size', options: PAGE_SIZE_OPTIONS }}
            visibleContentPreference={{
              title: 'Visible columns',
              options: [
                {
                  label: 'Service properties',
                  options: [
                    { id: 'category', label: 'Category', editable: true },
                    { id: 'status', label: 'LocalStack status', editable: true },
                    { id: 'parity', label: 'LocalDeck support', editable: true },
                    { id: 'operations', label: 'Operations', editable: true },
                  ],
                },
              ],
            }}
            preferences={{ pageSize, visibleContent: [...visibleColumns] }}
            onConfirm={({ detail }) => {
              setPageSize(detail.pageSize ?? pageSize);
              const next = detail.visibleContent ?? visibleColumns;
              setVisibleColumns(
                next.filter((id): id is ColumnId =>
                  (ALL_COLUMN_IDS as readonly string[]).includes(id),
                ),
              );
              setCurrentPageIndex(1);
            }}
          />
        }
        empty={
          loading ? (
            <Box textAlign="center" color="inherit">
              <Box variant="strong">Checking {providerLabel}…</Box>
            </Box>
          ) : (
            <Box textAlign="center" color="inherit">
              <Box variant="strong">No services match the filter.</Box>
              <Box variant="p" color="inherit">
                Clear the filter or search the registry with {GLOBAL_SEARCH_SHORTCUT_LABEL}.
              </Box>
            </Box>
          )
        }
      />
    </ContentLayout>
  );
}
