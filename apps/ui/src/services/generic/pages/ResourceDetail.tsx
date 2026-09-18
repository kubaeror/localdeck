import type { ApiError, ServiceBrowserListOperation } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { JsonEditor } from '../../../components/JsonEditor';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { toApiError } from '../../../lib/apiClient';
import { serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  deleteGenericResource,
  describeGenericResource,
  loadGenericResourceTags,
  type GenericTag,
} from '../api';

type Phase = 'loading' | 'ready' | 'error';
type TagsState = readonly GenericTag[] | 'loading' | 'unavailable' | 'error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function fieldList(field: string | readonly string[] | undefined): readonly string[] {
  if (field === undefined) return [];
  return typeof field === 'string' ? [field] : field;
}

/** The most console-like title we can derive from the described object. */
function resourceTitle(
  described: Record<string, unknown>,
  list: ServiceBrowserListOperation | undefined,
  fallback: string,
): string {
  for (const path of [...fieldList(list?.nameField), 'Name', 'name', 'Id', 'id', 'Arn', 'arn']) {
    const value = readPath(described, path);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
}

interface DetailEntry {
  label: string;
  value: string;
}

/**
 * Flattens a described resource into dotted-path leaf entries, so the detail
 * page shows the structure ("Cluster.status") instead of one JSON blob.
 */
function flattenDetails(record: Record<string, unknown>): DetailEntry[] {
  const entries: DetailEntry[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (entries.length >= 60) return;
    if (isRecord(value)) {
      if (depth >= 3) {
        entries.push({ label: path, value: JSON.stringify(value) });
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, path.length === 0 ? key : `${path}.${key}`, depth + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      const scalars = value.filter(
        (entry): entry is string | number | boolean =>
          typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
      );
      if (value.length === 0) return;
      entries.push({
        label: path,
        value: scalars.length === value.length ? scalars.join(', ') : `${value.length} item(s)`,
      });
      return;
    }
    if (value === undefined || value === null) return;
    entries.push({ label: path, value: String(value) });
  };

  for (const [key, value] of Object.entries(record)) visit(value, key, 1);
  return entries;
}

/**
 * The generated detail page: structured properties, a tags view and the raw
 * SDK response as JSON — all read through the registry's browser binding.
 */
export function GenericResourceDetail({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const { resourceId: resourceIdParam = '' } = useParams();
  // React Router decodes route params once already; decoding again would turn
  // a literal "%20" inside an id into a space.
  const resourceId = resourceIdParam;
  const browser = descriptor.browser;

  const [resource, setResource] = useState<Record<string, unknown> | null>(null);
  // The id the current `resource` was described for. A deep-link/route change
  // reaches the tags effect one commit before `resource` is reset, so the
  // effect also compares this against the route id.
  const [describedId, setDescribedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [tags, setTags] = useState<TagsState>('loading');
  const [tagsError, setTagsError] = useState<ApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tagsReloadToken, setTagsReloadToken] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // The previous resource (properties, raw JSON and tags) must not stay on
    // screen while the new id is described: reset it and show the loading
    // state. Every state update after this happens in the fetch continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset + initial data fetch
    setResource(null);
    setDescribedId(null);
    setTags('loading');
    setTagsError(null);
    setPhase('loading');

    void (async () => {
      try {
        const described = await describeGenericResource(descriptor, resourceId, controller.signal);
        if (controller.signal.aborted) return;
        setResource(described);
        setDescribedId(resourceId);
        setError(null);
        setPhase('ready');
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toApiError(caught));
        setPhase('error');
      }
    })();

    return () => {
      controller.abort();
    };
  }, [descriptor, resourceId, reloadToken]);

  // Tags load (and retry) independently of the describe call.
  useEffect(() => {
    // On an id change this effect runs in the commit where `resource` is still
    // the previous one; without the described-id guard it would ask for tags
    // for the new id (or read embedded tags from the old resource) before that
    // id's describe has completed.
    if (resource === null || describedId !== resourceId) return undefined;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tags fetch for the described resource
    setTags('loading');
    setTagsError(null);

    void (async () => {
      try {
        const loaded = await loadGenericResourceTags(
          descriptor,
          resource,
          resourceId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setTags(loaded === undefined ? 'unavailable' : loaded);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setTagsError(toApiError(caught));
        setTags('error');
      }
    })();

    return () => {
      controller.abort();
    };
  }, [describedId, descriptor, resource, resourceId, tagsReloadToken]);

  const details = useMemo(() => (resource === null ? [] : flattenDetails(resource)), [resource]);
  const title = resource === null ? resourceId : resourceTitle(resource, browser?.list, resourceId);

  const confirmDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGenericResource(descriptor, resourceId);
      flashbar.notify({
        type: 'success',
        header: `${title} deleted`,
        content: `The ${descriptor.displayName} delete operation was accepted.`,
      });
      navigate(serviceConsolePath(descriptor.id));
    } catch (caught) {
      setDeleteError(toApiError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ResourceDetailPage
        title={title}
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: resourceId },
        ]}
        loading={phase === 'loading'}
        error={phase === 'error' ? error : null}
        onRetry={() => {
          setReloadToken((value) => value + 1);
        }}
        headerActions={
          browser?.delete === undefined ? undefined : (
            <Button
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
            >
              Delete
            </Button>
          )
        }
        tabs={[
          {
            id: 'details',
            label: 'Details',
            content: (
              <Container header={<Header variant="h2">Properties</Header>}>
                {details.length === 0 ? (
                  <Box color="text-status-inactive">
                    {phase === 'loading'
                      ? 'Loading…'
                      : 'The describe operation returned no fields.'}
                  </Box>
                ) : (
                  <KeyValuePairs
                    columns={3}
                    items={details.map((entry) => ({
                      label: entry.label,
                      value: <Box variant="code">{entry.value}</Box>,
                    }))}
                  />
                )}
              </Container>
            ),
          },
          {
            id: 'tags',
            label: 'Tags',
            content: (
              <SpaceBetween size="m">
                {tagsError === null ? null : (
                  <Alert
                    type="error"
                    header="Could not load the tags"
                    action={
                      <Button
                        onClick={() => {
                          setTagsReloadToken((value) => value + 1);
                        }}
                      >
                        Retry
                      </Button>
                    }
                  >
                    {tagsError.message}
                  </Alert>
                )}
                <Table<GenericTag>
                  variant="container"
                  loading={tags === 'loading'}
                  loadingText="Loading tags"
                  items={
                    tags === 'loading' || tags === 'unavailable' || tags === 'error' ? [] : tags
                  }
                  columnDefinitions={[
                    { id: 'key', header: 'Key', cell: (tag) => tag.key, isRowHeader: true },
                    { id: 'value', header: 'Value', cell: (tag) => tag.value },
                  ]}
                  header={
                    <Header
                      variant="h2"
                      counter={
                        tags === 'loading' || tags === 'unavailable' || tags === 'error'
                          ? undefined
                          : `(${tags.length})`
                      }
                      description={
                        browser?.tags === undefined
                          ? 'Tags embedded in the describe response.'
                          : `Tags from ${browser.tags.operation}.`
                      }
                    >
                      Tags
                    </Header>
                  }
                  empty={
                    <Box textAlign="center" color="text-status-inactive">
                      {tags === 'unavailable'
                        ? 'This service does not expose a tags operation or embedded tags.'
                        : tags === 'error'
                          ? 'The tags operation failed. The resource itself loaded fine.'
                          : 'No tags are attached to this resource.'}
                    </Box>
                  }
                />
              </SpaceBetween>
            ),
          },
          {
            id: 'json',
            label: 'Raw JSON',
            content: (
              <Container header={<Header variant="h2">Describe response</Header>}>
                <JsonEditor
                  value={resource === null ? '' : JSON.stringify(resource, null, 2)}
                  readOnly
                  label={`${descriptor.displayName} resource`}
                  description={`Verbatim result of ${browser?.describe?.operation ?? browser?.list.operation ?? 'the read operation'}.`}
                  rows={20}
                />
              </Container>
            ),
          },
        ]}
      />

      {confirmingDelete ? (
        <DeleteConfirmModal
          visible
          title={`Delete ${descriptor.displayName} resource`}
          subjects={[title]}
          description={
            <>
              This calls <code>{browser?.delete?.operation}</code> with <code>{resourceId}</code>.
              The action cannot be undone.
            </>
          }
          confirmationText="delete"
          loading={deleting}
          errorText={deleteError ?? undefined}
          onDismiss={() => {
            setConfirmingDelete(false);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}

      <Box padding={{ top: 'l' }}>
        <Link
          href={serviceConsolePath(descriptor.id)}
          onFollow={(event) => {
            event.preventDefault();
            navigate(serviceConsolePath(descriptor.id));
          }}
        >
          Back to {descriptor.displayName} resources
        </Link>
      </Box>
    </>
  );
}
