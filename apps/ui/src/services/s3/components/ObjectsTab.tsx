import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { EmptyState } from '../../../components/EmptyState';
import { InfoTooltip } from '../../../components/InfoTooltip';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { serviceConsolePath } from '../../paths';
import {
  deleteFolder,
  deleteObjects,
  downloadObjectUrl,
  listObjects,
  triggerDownload,
  type S3Bucket,
  type S3ObjectEntry,
  type S3ObjectPage,
} from '../api';
import { toFriendlyS3Error } from '../errors';
import { BucketListPanel } from './BucketListPanel';
import { CopyMoveModal } from './CopyMoveModal';
import { CreateFolderModal } from './CreateFolderModal';
import { ObjectMetadataModal } from './ObjectMetadataModal';
import { UploadModal } from './UploadModal';

export interface ObjectsTabProps {
  bucket: string;
  /** Buckets for the left panel and the copy/move picker; owned by the page. */
  buckets: readonly S3Bucket[];
  bucketsLoading: boolean;
  bucketsError: ApiError | null;
  onRefreshBuckets: () => void;
}

const EMPTY_PAGE: S3ObjectPage = { folders: [], objects: [] };

/** Folders first, then objects sorted by the selected column. */
function sortEntries(
  page: S3ObjectPage,
  field: string,
  descending: boolean,
): readonly S3ObjectEntry[] {
  const direction = descending ? -1 : 1;
  const byName = (left: S3ObjectEntry, right: S3ObjectEntry): number =>
    left.name.localeCompare(right.name, 'en') * direction;

  const folders = [...page.folders].sort(byName);
  const objects = [...page.objects].sort((left, right) => {
    if (field === 'size') return ((left.size ?? 0) - (right.size ?? 0)) * direction;
    if (field === 'lastModified') {
      return (
        String(left.lastModified ?? '').localeCompare(String(right.lastModified ?? '')) * direction
      );
    }
    if (field === 'storageClass') {
      return (
        String(left.storageClass ?? '').localeCompare(String(right.storageClass ?? '')) * direction
      );
    }
    return byName(left, right);
  });

  return [...folders, ...objects];
}

/**
 * The bucket's Objects tab: the console's two-panel browser. The left panel
 * lists buckets, the right panel browses one prefix at a time with
 * `Delimiter: '/'`, so S3 reports folders as common prefixes and objects as
 * keys. Uploads, downloads, copy/move, metadata and delete all go through the
 * api proxy.
 */
export function ObjectsTab({
  bucket,
  buckets,
  bucketsLoading,
  bucketsError,
  onRefreshBuckets,
}: ObjectsTabProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [prefix, setPrefix] = useState('');
  const [page, setPage] = useState<S3ObjectPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const [selected, setSelected] = useState<readonly S3ObjectEntry[]>([]);
  const [sortingField, setSortingField] = useState('name');
  const [descending, setDescending] = useState(false);

  const [uploadVisible, setUploadVisible] = useState(false);
  const [createFolderVisible, setCreateFolderVisible] = useState(false);
  const [copyMove, setCopyMove] = useState<{ mode: 'copy' | 'move'; entry: S3ObjectEntry } | null>(
    null,
  );
  const [metadataEntry, setMetadataEntry] = useState<S3ObjectEntry | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<readonly S3ObjectEntry[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const inFlight = useRef<AbortController | null>(null);
  // Bumped whenever the folder (or bucket) changes; a "load more" response that
  // belongs to a previous generation must never be appended to the new page.
  const requestGeneration = useRef(0);

  const loadObjects = useCallback(async (): Promise<void> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setLoading(true);
    setLoadingMore(false);
    setPage(EMPTY_PAGE);
    setSelected([]);

    try {
      const result = await listObjects({
        bucket,
        ...(prefix.length === 0 ? {} : { prefix }),
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setPage(result);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setError(toApiError(caught));
    } finally {
      if (!controller.signal.aborted && requestGeneration.current === generation) {
        setLoading(false);
      }
    }
  }, [bucket, prefix]);

  /** Refetches the current folder and clears any selection. */
  const reload = useCallback((): void => {
    setSelected([]);
    void loadObjects();
  }, [loadObjects]);

  // Current prefix, refetched whenever the folder or the bucket changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch for the current folder
    void loadObjects();
    return () => {
      inFlight.current?.abort();
      requestGeneration.current += 1;
    };
  }, [loadObjects]);

  const loadMore = useCallback(async (): Promise<void> => {
    const token = page.nextToken;
    if (token === undefined) return;
    // Same in-flight slot as the folder fetch: switching folders aborts this
    // request, and the generation check discards a response that raced it.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const generation = requestGeneration.current;
    setLoadingMore(true);
    try {
      const next = await listObjects({
        bucket,
        ...(prefix.length === 0 ? {} : { prefix }),
        continuationToken: token,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setPage((previous) => ({
        folders: [...previous.folders, ...next.folders],
        objects: [...previous.objects, ...next.objects],
        ...(next.nextToken === undefined ? {} : { nextToken: next.nextToken }),
      }));
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setError(toApiError(caught));
    } finally {
      if (!controller.signal.aborted && requestGeneration.current === generation) {
        setLoadingMore(false);
      }
    }
  }, [bucket, prefix, page.nextToken]);

  const items = useMemo(
    () => sortEntries(page, sortingField, descending),
    [page, sortingField, descending],
  );

  const segments = prefix.split('/').filter((segment) => segment.length > 0);
  const breadcrumbItems = [
    { text: bucket, href: '#' },
    ...segments.map((segment, index) => ({
      text: segment,
      href: `#${segments.slice(0, index + 1).join('/')}/`,
    })),
  ];

  const openEntry = useCallback((entry: S3ObjectEntry): void => {
    if (entry.kind === 'folder') {
      setPrefix(entry.key);
      return;
    }
    setMetadataEntry(entry);
  }, []);

  const download = (entry: S3ObjectEntry): void => {
    triggerDownload(downloadObjectUrl({ bucket, key: entry.key }));
  };

  const confirmDelete = async (): Promise<void> => {
    const targets = deleteTargets ?? [];
    if (targets.length === 0) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const objects = targets.filter((entry) => entry.kind === 'object').map((entry) => entry.key);
      const folders = targets.filter((entry) => entry.kind === 'folder').map((entry) => entry.key);

      let deleted = 0;
      const failures: string[] = [];

      if (objects.length > 0) {
        const result = await deleteObjects({ bucket, keys: objects });
        deleted += result.deleted.length;
        failures.push(
          ...result.failures.map(
            (failure) => `${failure.key}: ${failure.message ?? failure.code ?? 'failed'}`,
          ),
        );
      }
      for (const folder of folders) {
        const result = await deleteFolder({ bucket, prefix: folder });
        deleted += result.deleted.length;
        failures.push(
          ...result.failures.map(
            (failure) => `${failure.key}: ${failure.message ?? failure.code ?? 'failed'}`,
          ),
        );
      }

      if (deleted > 0) {
        flashbar.notify({
          type: 'success',
          header: deleted === 1 ? 'Object deleted' : `${deleted} objects deleted`,
          content: targets
            .map((entry) => entry.key)
            .join(', ')
            .slice(0, 200),
        });
      }
      for (const failure of failures) {
        flashbar.notify({ type: 'error', header: 'Could not delete an object', content: failure });
      }
      setDeleteTargets(null);
    } catch (caught) {
      setDeleteError(toFriendlyS3Error(caught).message);
    } finally {
      setDeleting(false);
      // Deleted keys must disappear even when the delete reported failures, so
      // the table never keeps showing objects that are already gone.
      reload();
    }
  };

  const columns = useMemo<readonly TableProps.ColumnDefinition<S3ObjectEntry>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (entry) =>
          entry.kind === 'folder' ? (
            <Link
              href="#"
              onFollow={(event) => {
                event.preventDefault();
                openEntry(entry);
              }}
            >
              {entry.name}
            </Link>
          ) : (
            <Link
              href="#"
              onFollow={(event) => {
                event.preventDefault();
                setMetadataEntry(entry);
              }}
            >
              {entry.name}
            </Link>
          ),
      },
      {
        id: 'type',
        header: 'Type',
        width: 110,
        cell: (entry) => (entry.kind === 'folder' ? 'Folder' : 'Object'),
      },
      {
        id: 'size',
        header: 'Size',
        width: 110,
        sortingField: 'size',
        cell: (entry) => (entry.kind === 'folder' ? '—' : formatBytes(entry.size ?? 0)),
      },
      {
        id: 'lastModified',
        header: 'Last modified',
        width: 220,
        sortingField: 'lastModified',
        cell: (entry) => (entry.kind === 'folder' ? '—' : formatDateTime(entry.lastModified)),
      },
      {
        id: 'storageClass',
        header: 'Storage class',
        width: 140,
        sortingField: 'storageClass',
        cell: (entry) => (entry.kind === 'folder' ? '—' : (entry.storageClass ?? 'STANDARD')),
      },
      {
        id: 'actions',
        header: 'Actions',
        width: 150,
        cell: (entry) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${entry.key}`}
            items={
              entry.kind === 'folder'
                ? [
                    { id: 'open', text: 'Open' },
                    { id: 'delete', text: 'Delete folder' },
                  ]
                : [
                    { id: 'metadata', text: 'View metadata' },
                    { id: 'download', text: 'Download' },
                    { id: 'copy', text: 'Copy' },
                    { id: 'move', text: 'Move' },
                    { id: 'delete', text: 'Delete' },
                  ]
            }
            onItemClick={({ detail }) => {
              if (detail.id === 'open') setPrefix(entry.key);
              if (detail.id === 'metadata') setMetadataEntry(entry);
              if (detail.id === 'download') download(entry);
              if (detail.id === 'copy') setCopyMove({ mode: 'copy', entry });
              if (detail.id === 'move') setCopyMove({ mode: 'move', entry });
              if (detail.id === 'delete') setDeleteTargets([entry]);
            }}
          />
        ),
      },
    ],
    // openEntry/download only close over setState and the bucket prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openEntry, bucket],
  );

  const selectionActions =
    selected.length === 0 ? null : (
      <SpaceBetween direction="horizontal" size="xs">
        <ButtonDropdown
          ariaLabel="Object bulk actions"
          items={[
            {
              id: 'download',
              text: 'Download',
              disabled: !(selected.length === 1 && selected[0]?.kind === 'object'),
            },
            {
              id: 'copy',
              text: 'Copy',
              disabled: !(selected.length === 1 && selected[0]?.kind === 'object'),
            },
            {
              id: 'move',
              text: 'Move',
              disabled: !(selected.length === 1 && selected[0]?.kind === 'object'),
            },
            { id: 'delete', text: 'Delete' },
          ]}
          onItemClick={({ detail }) => {
            const entry = selected[0];
            if (detail.id === 'delete') setDeleteTargets([...selected]);
            if (entry === undefined) return;
            if (detail.id === 'download') download(entry);
            if (detail.id === 'copy') setCopyMove({ mode: 'copy', entry });
            if (detail.id === 'move') setCopyMove({ mode: 'move', entry });
          }}
        >
          Actions
        </ButtonDropdown>
        <Button
          variant="link"
          onClick={() => {
            setSelected([]);
          }}
        >
          Clear selection
        </Button>
      </SpaceBetween>
    );

  const headerActions = (
    <SpaceBetween direction="horizontal" size="xs">
      <Button variant="primary" onClick={() => setUploadVisible(true)}>
        Upload
      </Button>
      <Button onClick={() => setCreateFolderVisible(true)}>Create folder</Button>
      <InfoTooltip content="Version history requires ListObjectVersions, which is not enabled in the LocalDeck registry yet.">
        <Button disabled>Show versions</Button>
      </InfoTooltip>
      <Button iconName="refresh" ariaLabel="Refresh objects" loading={loading} onClick={reload} />
    </SpaceBetween>
  );

  const emptyState =
    prefix.length === 0 ? (
      <EmptyState
        title="No objects"
        description="This bucket is empty. Upload objects or create a folder to get started."
        action={
          <Button variant="primary" onClick={() => setUploadVisible(true)}>
            Upload
          </Button>
        }
        secondaryAction={
          <Button onClick={() => setCreateFolderVisible(true)}>Create folder</Button>
        }
      />
    ) : (
      <EmptyState
        title="This folder is empty"
        description={`There are no objects under "${prefix}". Upload objects or create a nested folder.`}
        action={
          <Button variant="primary" onClick={() => setUploadVisible(true)}>
            Upload
          </Button>
        }
      />
    );

  return (
    <>
      <Grid
        gridDefinition={[
          { colspan: { default: 12, m: 3, l: 3 } },
          { colspan: { default: 12, m: 9, l: 9 } },
        ]}
      >
        <BucketListPanel
          buckets={buckets}
          loading={bucketsLoading}
          error={bucketsError}
          selectedBucket={bucket}
          onSelect={(name) => {
            navigate(`${serviceConsolePath('s3')}/buckets/${encodeURIComponent(name)}`);
          }}
          onRefresh={onRefreshBuckets}
        />

        <Container
          header={
            <Header
              variant="h2"
              counter={`(${items.length}${page.nextToken === undefined ? '' : '+'})`}
              actions={selectionActions ?? headerActions}
            >
              Objects
            </Header>
          }
        >
          <SpaceBetween size="m">
            <BreadcrumbGroup
              items={breadcrumbItems}
              ariaLabel="Object prefix"
              onFollow={(event) => {
                event.preventDefault();
                const href = event.detail.href;
                setPrefix(href === '#' ? '' : href.slice(1));
                setSelected([]);
              }}
            />

            {error === null ? null : (
              <Alert
                type="error"
                header="Could not list objects"
                action={<Button onClick={reload}>Retry</Button>}
              >
                {error.message}
              </Alert>
            )}

            <Table<S3ObjectEntry>
              variant="embedded"
              loading={loading}
              loadingText="Loading objects"
              items={items}
              columnDefinitions={columns}
              trackBy={(entry) => entry.key}
              empty={emptyState}
              selectionType="multi"
              selectedItems={selected}
              ariaLabels={{
                tableLabel: 'Objects',
                selectionGroupLabel: 'Object selection',
                allItemsSelectionLabel: () => 'Select all objects on this page',
                itemSelectionLabel: (_data, entry) => `Select ${entry.key}`,
              }}
              onSelectionChange={({ detail }) => {
                setSelected(detail.selectedItems);
              }}
              sortingColumn={{ sortingField }}
              sortingDescending={descending}
              onSortingChange={({ detail }) => {
                setSortingField(detail.sortingColumn.sortingField ?? 'name');
                setDescending(detail.isDescending ?? false);
              }}
              pagination={
                page.nextToken === undefined ? undefined : (
                  <Button loading={loadingMore} onClick={() => void loadMore()}>
                    Load more
                  </Button>
                )
              }
            />
          </SpaceBetween>
        </Container>
      </Grid>

      <UploadModal
        visible={uploadVisible}
        bucket={bucket}
        prefix={prefix}
        onDismiss={() => {
          setUploadVisible(false);
        }}
        onUploaded={(keys) => {
          flashbar.notify({
            type: 'success',
            header: keys.length === 1 ? 'Object uploaded' : `${keys.length} objects uploaded`,
            content: keys.join(', ').slice(0, 200),
          });
          reload();
        }}
      />

      <CreateFolderModal
        visible={createFolderVisible}
        bucket={bucket}
        prefix={prefix}
        onDismiss={() => {
          setCreateFolderVisible(false);
        }}
        onCreated={(key) => {
          flashbar.notify({ type: 'success', header: 'Folder created', content: key });
          reload();
        }}
      />

      {copyMove === null ? null : (
        <CopyMoveModal
          mode={copyMove.mode}
          sourceBucket={bucket}
          source={copyMove.entry}
          buckets={buckets}
          defaultPrefix={prefix}
          onDismiss={() => {
            setCopyMove(null);
          }}
          onDone={(message) => {
            flashbar.notify({
              type: 'success',
              header: 'Object copied or moved',
              content: message,
            });
            reload();
          }}
        />
      )}

      {metadataEntry === null ? null : (
        <ObjectMetadataModal
          bucket={bucket}
          entry={metadataEntry}
          onDismiss={() => {
            setMetadataEntry(null);
          }}
          onDownload={() => {
            download(metadataEntry);
          }}
        />
      )}

      {deleteTargets === null ? null : (
        <DeleteConfirmModal
          visible
          title="Delete objects"
          subjects={deleteTargets.map((entry) => entry.key)}
          description={
            deleteTargets.some((entry) => entry.kind === 'folder')
              ? 'Deleting a folder also deletes every object under it. This action cannot be undone.'
              : 'This action cannot be undone.'
          }
          confirmationText="delete"
          submitLabel="Delete"
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

export default ObjectsTab;
