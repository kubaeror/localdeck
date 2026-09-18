import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import type { LocalStackServiceStatus } from '@localdeck/shared';
import { useMemo, useState, type ReactElement } from 'react';
import { formatServiceName } from '../lib/format';
import { StatusBadge } from './StatusBadge';

interface ServiceRow {
  id: string;
  status: LocalStackServiceStatus;
}

const PAGE_SIZE = 20;

const COLUMN_DEFINITIONS: TableProps.ColumnDefinition<ServiceRow>[] = [
  {
    id: 'service',
    header: 'Service',
    sortingField: 'id',
    cell: (row) => <Box variant="code">{row.id}</Box>,
    isRowHeader: true,
  },
  {
    id: 'name',
    header: 'Console name',
    cell: (row) => formatServiceName(row.id),
  },
  {
    id: 'status',
    header: 'LocalStack status',
    sortingField: 'status',
    cell: (row) => <StatusBadge status={row.status} />,
  },
];

export interface ServiceAvailabilityTableProps {
  services: Readonly<Record<string, LocalStackServiceStatus>>;
  onRefresh: () => void;
}

/** Every service reported by /_localstack/health, with its current status. */
export function ServiceAvailabilityTable({
  services,
  onRefresh,
}: ServiceAvailabilityTableProps): ReactElement {
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<ServiceRow>>({
    sortingField: 'id',
  });
  const [isSortingDescending, setIsSortingDescending] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(1);

  const rows = useMemo<ServiceRow[]>(() => {
    const collected = Object.entries(services).map(([id, status]) => ({ id, status }));
    const field = sortingColumn.sortingField;
    if (field !== 'id' && field !== 'status') return collected;

    const direction = isSortingDescending ? -1 : 1;
    return collected.sort((left, right) => {
      const compared = left[field].localeCompare(right[field]);
      // The id tie-break follows the same direction as the sorted field,
      // otherwise a descending sort mixes ascending ids into the output.
      const tieBreak = left.id.localeCompare(right.id);
      return (compared === 0 ? tieBreak : compared) * direction;
    });
  }, [services, sortingColumn, isSortingDescending]);

  const pagesCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // The service list can shrink between health polls; clamp instead of showing
  // an empty page.
  const pageIndex = Math.min(currentPageIndex, pagesCount);
  const visibleRows = rows.slice((pageIndex - 1) * PAGE_SIZE, pageIndex * PAGE_SIZE);

  return (
    <Table<ServiceRow>
      items={visibleRows}
      columnDefinitions={COLUMN_DEFINITIONS}
      sortingColumn={sortingColumn}
      sortingDescending={isSortingDescending}
      onSortingChange={({ detail }) => {
        setSortingColumn(detail.sortingColumn);
        setIsSortingDescending(detail.isDescending ?? false);
        setCurrentPageIndex(1);
      }}
      header={
        <Header
          variant="h2"
          counter={`(${rows.length})`}
          description="Reported live by the LocalStack health endpoint."
          actions={
            <SpaceBetween size="xs" direction="horizontal">
              <Button iconName="refresh" onClick={onRefresh}>
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Emulated services
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
      empty={<Box textAlign="center">No services reported by LocalStack.</Box>}
    />
  );
}
