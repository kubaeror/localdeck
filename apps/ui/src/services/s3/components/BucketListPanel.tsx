import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useMemo, type ReactElement } from 'react';
import type { S3Bucket } from '../api';

export interface BucketListPanelProps {
  buckets: readonly S3Bucket[];
  loading: boolean;
  error: ApiError | null;
  /** The bucket whose objects the right panel shows. */
  selectedBucket: string;
  onSelect: (bucket: string) => void;
  onRefresh: () => void;
}

/**
 * The object browser's left panel: every bucket, single-select, with the
 * current one highlighted. Selecting a bucket navigates to its detail page.
 */
export function BucketListPanel({
  buckets,
  loading,
  error,
  selectedBucket,
  onSelect,
  onRefresh,
}: BucketListPanelProps): ReactElement {
  const items = useMemo(
    () => [...buckets].sort((left, right) => left.name.localeCompare(right.name, 'en')),
    [buckets],
  );
  const selectedItems = useMemo(
    () => items.filter((bucket) => bucket.name === selectedBucket),
    [items, selectedBucket],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<S3Bucket>[]>(
    () => [
      {
        id: 'name',
        header: 'Buckets',
        isRowHeader: true,
        cell: (bucket) => (
          <Link
            href="#"
            onFollow={(event) => {
              event.preventDefault();
              onSelect(bucket.name);
            }}
          >
            {bucket.name}
          </Link>
        ),
      },
    ],
    [onSelect],
  );

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button
              iconName="refresh"
              ariaLabel="Refresh buckets"
              loading={loading}
              onClick={onRefresh}
            />
          }
        >
          Buckets
        </Header>
      }
    >
      <SpaceBetween size="s">
        {error === null ? null : (
          <Alert type="error" header="Could not load buckets">
            {error.message}
          </Alert>
        )}
        <Table<S3Bucket>
          variant="embedded"
          loading={loading}
          loadingText="Loading buckets"
          items={items}
          columnDefinitions={columns}
          trackBy={(bucket) => bucket.name}
          selectionType="single"
          selectedItems={selectedItems}
          ariaLabels={{
            tableLabel: 'Buckets',
            selectionGroupLabel: 'Bucket selection',
            itemSelectionLabel: (_data, bucket) => `Select ${bucket.name}`,
            allItemsSelectionLabel: () => 'Select the only bucket',
          }}
          onSelectionChange={({ detail }) => {
            const next = detail.selectedItems[0];
            if (next !== undefined && next.name !== selectedBucket) onSelect(next.name);
          }}
          empty="No buckets yet. Create one to upload objects."
        />
      </SpaceBetween>
    </Container>
  );
}

export default BucketListPanel;
