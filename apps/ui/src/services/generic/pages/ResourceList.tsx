import type { TableProps } from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { toApiError } from '../../../lib/apiClient';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import { deleteGenericResource, listGenericResources, type GenericResourceRow } from '../api';

/** Properties that never read well as table columns. */
const SKIPPED_PROPERTY_KEYS = new Set(['ResponseMetadata', '$metadata', 'Tags', 'tags']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Short `key: value` summary of the first few scalar properties of an item. */
function summarizeProperties(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (parts.length === 3) break;
    if (SKIPPED_PROPERTY_KEYS.has(key)) continue;
    const rendered =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : isRecord(value)
            ? `${Object.keys(value).length} field(s)`
            : undefined;
    if (rendered === undefined) continue;
    parts.push(`${key}: ${rendered.length > 48 ? `${rendered.slice(0, 45)}…` : rendered}`);
  }
  return parts.length === 0 ? '—' : parts.join(' · ');
}

function rowMatches(row: GenericResourceRow, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (row.id.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle))
    return true;
  return Object.entries(row.raw).some(([key, value]) => {
    if (key.toLowerCase().includes(needle)) return true;
    if (typeof value === 'string') return value.toLowerCase().includes(needle);
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(needle);
    }
    return false;
  });
}

/**
 * The generated resource list: `ResourceListPage` driven entirely by the
 * registry's browser spec (listOp + resultPath/idField/nameField). Services
 * with a dedicated module never render this page — the module wins.
 */
export function GenericResourceList({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const browser = descriptor.browser;

  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<GenericResourceRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetcher = useCallback(
    ({ nextToken, signal }: { nextToken?: string; signal?: AbortSignal }) =>
      listGenericResources(descriptor, {
        ...(nextToken === undefined ? {} : { nextToken }),
        ...(signal === undefined ? {} : { signal }),
      }),
    [descriptor],
  );

  const openDetail = (row: GenericResourceRow): void => {
    navigate(`${serviceConsolePath(descriptor.id)}/resources/${encodeURIComponent(row.id)}`);
  };

  const confirmDelete = async (): Promise<void> => {
    if (pendingDelete === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGenericResource(descriptor, pendingDelete.id);
      flashbar.notify({
        type: 'success',
        header: `${pendingDelete.label} deleted`,
        content: `The ${descriptor.displayName} delete operation was accepted.`,
      });
      setPendingDelete(null);
      setReloadToken((value) => value + 1);
    } catch (caught) {
      setDeleteError(toApiError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const columns: readonly TableProps.ColumnDefinition<GenericResourceRow>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      sortingField: 'label',
      cell: (row) =>
        browser?.describe === undefined ? (
          row.label
        ) : (
          <Link
            href={`${serviceConsolePath(descriptor.id)}/resources/${encodeURIComponent(row.id)}`}
            onFollow={(event) => {
              event.preventDefault();
              openDetail(row);
            }}
          >
            {row.label}
          </Link>
        ),
    },
    {
      id: 'identifier',
      header: 'Identifier',
      sortingField: 'id',
      cell: (row) => row.id,
    },
    {
      id: 'properties',
      header: 'Properties',
      cell: (row) => summarizeProperties(row.raw),
    },
  ];

  return (
    <>
      <ResourceListPage<GenericResourceRow>
        title={`${descriptor.displayName} resources`}
        description={
          <>
            Generated from the registry binding: <code>{browser?.list.operation}</code>. Details,
            tags and JSON come from the same whitelisted operations the api proxies.
          </>
        }
        breadcrumbs={[{ text: descriptor.displayName }]}
        columns={columns}
        fetcher={fetcher}
        getRowId={(row) => row.id}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: `Find ${descriptor.displayName.toLowerCase()} resources`,
          match: rowMatches,
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/create`);
            }}
          >
            Create resource
          </Button>
        }
        rowActions={(row) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="inline-link" onClick={() => openDetail(row)}>
              View details
            </Button>
            {browser?.delete === undefined ? null : (
              <Button
                variant="inline-link"
                onClick={() => {
                  setDeleteError(null);
                  setPendingDelete(row);
                }}
              >
                Delete
              </Button>
            )}
          </SpaceBetween>
        )}
        emptyTitle={`No ${descriptor.displayName} resources yet`}
        emptyDescription={
          <>
            <code>{browser?.list.operation ?? 'the list operation'}</code> returned no resources, or
            this LocalStack does not emulate them. The generated browser is read-only for now; use
            the AWS CLI against LocalStack or a dedicated module to create resources.
          </>
        }
        reloadToken={reloadToken}
      />

      {pendingDelete === null ? null : (
        <DeleteConfirmModal
          visible
          title={`Delete ${descriptor.displayName} resource`}
          subjects={[pendingDelete.label]}
          description={
            <>
              This calls <code>{browser?.delete?.operation}</code> with{' '}
              <code>{pendingDelete.id}</code>. The action cannot be undone.
            </>
          }
          confirmationText="delete"
          loading={deleting}
          errorText={deleteError ?? undefined}
          onDismiss={() => {
            setPendingDelete(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      )}
    </>
  );
}
