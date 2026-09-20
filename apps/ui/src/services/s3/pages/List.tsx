import type { TableProps } from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteBuckets, listBuckets, type S3Bucket } from '../api';
import { toFriendlyS3Error } from '../errors';

/**
 * The S3 bucket list: Name and Creation date, name filtering, per-row actions
 * and bulk delete with the console's typed confirmation. Buckets are deleted
 * one call each, so partial failures are reported instead of hidden.
 */
export function ListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const [filteringText, setFilteringText] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<readonly string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const openBucket = useCallback(
    (bucket: string) => {
      void navigate(`${serviceConsolePath(descriptor.id)}/buckets/${encodeURIComponent(bucket)}`);
    },
    [descriptor.id, navigate],
  );

  const columns = useMemo<readonly TableProps.ColumnDefinition<S3Bucket>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (bucket) => (
          <Link
            href={`${serviceConsolePath(descriptor.id)}/buckets/${encodeURIComponent(bucket.name)}`}
            onFollow={(event) => {
              event.preventDefault();
              openBucket(bucket.name);
            }}
          >
            {bucket.name}
          </Link>
        ),
      },
      {
        id: 'creationDate',
        header: 'Creation date',
        sortingField: 'creationDate',
        cell: (bucket) => formatDateTime(bucket.creationDate),
      },
    ],
    [descriptor.id, openBucket],
  );

  const confirmDelete = async (): Promise<void> => {
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteBuckets(targets);
      for (const bucket of result.deleted) {
        flashbar.notify({
          type: 'success',
          header: 'Bucket deleted',
          content: bucket,
        });
      }
      for (const failure of result.failures) {
        flashbar.notify({
          type: 'error',
          header: `Could not delete ${failure.bucket}`,
          content: failure.error.message,
        });
      }
      setDeleteTargets(null);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setDeleteError(toFriendlyS3Error(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceListPage<S3Bucket>
        title="Buckets"
        description={descriptor.summary}
        breadcrumbs={[{ text: descriptor.displayName }]}
        columns={columns}
        getRowId={(bucket) => bucket.name}
        reloadToken={reloadToken}
        preferencesId="s3-buckets"
        pageSizeOptions={[
          { value: 10, label: '10 buckets' },
          { value: 25, label: '25 buckets' },
          { value: 50, label: '50 buckets' },
        ]}
        visibleContentPreference={{
          title: 'Visible columns',
          options: [
            {
              label: 'Bucket columns',
              options: [
                { id: 'name', label: 'Name' },
                { id: 'creationDate', label: 'Creation date' },
              ],
            },
          ],
        }}
        fetcher={({ signal }) => listBuckets({ ...(signal === undefined ? {} : { signal }) })}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find buckets by name',
          match: (bucket, text) => bucket.name.toLowerCase().includes(text.trim().toLowerCase()),
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              void navigate(`${serviceConsolePath(descriptor.id)}/create`);
            }}
          >
            Create bucket
          </Button>
        }
        rowActions={(bucket) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${bucket.name}`}
            items={[
              { id: 'view', text: 'View details' },
              { id: 'copy-arn', text: 'Copy ARN' },
              { id: 'delete', text: 'Delete', disabled: false },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') openBucket(bucket.name);
              if (detail.id === 'copy-arn') {
                void navigator.clipboard?.writeText(`arn:aws:s3:::${bucket.name}`);
              }
              if (detail.id === 'delete') setDeleteTargets([bucket.name]);
            }}
          />
        )}
        bulkActions={(selected) => (
          <ButtonDropdown
            ariaLabel="Bulk actions"
            items={[{ id: 'delete', text: 'Delete' }]}
            onItemClick={({ detail }) => {
              if (detail.id === 'delete') {
                setDeleteTargets(selected.map((bucket) => bucket.name));
              }
            }}
          >
            Actions
          </ButtonDropdown>
        )}
        emptyTitle="No buckets"
        emptyDescription="Buckets are containers for objects stored in S3. Create a bucket to get started."
      />

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title={deleteTargets.length === 1 ? 'Delete bucket' : 'Delete buckets'}
          subjects={deleteTargets}
          description={
            deleteTargets.length === 1
              ? `Objects in ${deleteTargets[0] ?? ''} must be deleted before the bucket can be deleted. This action cannot be undone.`
              : 'Every selected bucket must be empty before it can be deleted. This action cannot be undone.'
          }
          confirmationText={deleteTargets.length === 1 ? undefined : 'delete'}
          submitLabel={deleteTargets.length === 1 ? 'Delete bucket' : 'Delete buckets'}
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTargets(null);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </>
  );
}

export default ListPage;
