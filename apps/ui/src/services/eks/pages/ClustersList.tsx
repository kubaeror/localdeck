import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConsoleBreadcrumbs } from '../../../components/ConsoleBreadcrumbs';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { EmptyState } from '../../../components/EmptyState';
import { ResourceListPage } from '../../../components/ResourceListPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { useEmulatorStatus } from '../../../hooks/useEmulatorStatus';
import { usePolling } from '../../../hooks/usePolling';
import { formatDateTime } from '../../../lib/format';
import { DEFAULT_EMULATOR_DOCS_URL, serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  clusterStatusName,
  deleteCluster,
  isClusterTransitional,
  listClusterSummaries,
  type EksCluster,
} from '../api';
import { toFriendlyEksError } from '../errors';

/** How often the list reloads while a cluster is being created or deleted. */
const POLL_INTERVAL_MS = 10_000;

/**
 * The EKS clusters list: Name, Status, Kubernetes version and creation time.
 * LocalStack's EKS starts a real k3d cluster per CreateCluster, so the page
 * refreshes automatically while any cluster is CREATING or UPDATING and links
 * each row to its detail page (Overview / Compute / Tags).
 *
 * When LocalStack does not report the EKS service at all, the page renders an
 * empty state explaining what to enable instead of failing on the first call.
 */
export function ClustersListPage({ descriptor }: ServicePageProps): ReactElement {
  const navigate = useNavigate();
  const flashbar = useFlashbar();
  const status = useEmulatorStatus();
  const providerLabel =
    status.health?.provider.providerLabel ??
    status.config?.emulator.providerLabel ??
    'the emulator';
  const docsUrl = status.health?.provider.docsUrl ?? DEFAULT_EMULATOR_DOCS_URL;
  const [filteringText, setFilteringText] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [transitional, setTransitional] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EksCluster | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const listingPath = `${serviceConsolePath(descriptor.id)}/clusters`;

  const clusterPath = useCallback(
    (name: string) => `${listingPath}/${encodeURIComponent(name)}`,
    [listingPath],
  );

  const fetchPage = useCallback(async (options: { nextToken?: string; signal?: AbortSignal }) => {
    const items = await listClusterSummaries(options.signal);
    const hasTransitional = items.some((cluster) => isClusterTransitional(cluster.status));
    setTransitional((previous) => (previous === hasTransitional ? previous : hasTransitional));
    return { items };
  }, []);

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    setReloadToken((token) => token + 1);
  });

  const columns = useMemo<readonly TableProps.ColumnDefinition<EksCluster>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'name',
        isRowHeader: true,
        cell: (cluster) => (
          <Link
            href={clusterPath(cluster.name)}
            onFollow={(event) => {
              event.preventDefault();
              navigate(clusterPath(cluster.name));
            }}
          >
            {cluster.name}
          </Link>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        sortingField: 'status',
        cell: (cluster) => <StatusBadge status={clusterStatusName(cluster.status)} />,
      },
      {
        id: 'version',
        header: 'Kubernetes version',
        sortingField: 'version',
        cell: (cluster) => cluster.version,
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortingField: 'createdAt',
        cell: (cluster) => formatDateTime(cluster.createdAt),
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (cluster) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${cluster.name}`}
            items={[
              { id: 'view', text: 'View details' },
              {
                id: 'delete',
                text: 'Delete',
                // Only settled clusters can be deleted; a cluster that is
                // creating, updating or already deleting has no stable state.
                disabled: !['ACTIVE', 'FAILED'].includes(cluster.status),
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'view') navigate(clusterPath(cluster.name));
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeleteTarget(cluster);
              }
            }}
          />
        ),
      },
    ],
    [clusterPath, navigate],
  );

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null) return;
    const name = deleteTarget.name;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCluster(name);
      flashbar.notify({
        type: 'info',
        header: `Deleting cluster ${name}`,
        content: `${providerLabel} is tearing down the cluster. This can take a minute.`,
      });
      setDeleteTarget(null);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setDeleteError(toFriendlyEksError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  // LocalStack reports EKS under the `eks` health key. While the health
  // document is still loading the page waits, so it never fires EKS calls
  // against an instance that turns out not to emulate the service.
  const healthLoading = status.health === null && status.phase === 'loading';
  if (healthLoading) {
    return (
      <ContentLayout
        breadcrumbs={
          <ConsoleBreadcrumbs
            items={[{ text: descriptor.displayName, href: serviceConsolePath(descriptor.id) }]}
          />
        }
        header={
          <Header variant="h1" description={descriptor.summary}>
            {descriptor.displayName}
          </Header>
        }
      >
        <Box textAlign="center" padding="l">
          <Spinner size="large" />
        </Box>
      </ContentLayout>
    );
  }

  const eksStatus = status.health?.emulator.services['eks'];
  if (status.health !== null && eksStatus === undefined) {
    return (
      <ContentLayout
        breadcrumbs={
          <ConsoleBreadcrumbs
            items={[{ text: descriptor.displayName, href: serviceConsolePath(descriptor.id) }]}
          />
        }
        header={
          <Header
            variant="h1"
            description={descriptor.summary}
            actions={
              <Button
                onClick={() => {
                  status.refresh();
                }}
                loading={status.phase === 'loading'}
              >
                Re-check
              </Button>
            }
          >
            {descriptor.displayName}
          </Header>
        }
      >
        <EmptyState
          iconKey={descriptor.iconKey}
          iconCategory={descriptor.category}
          title={`EKS is not enabled in this ${providerLabel} instance`}
          description={
            <SpaceBetween size="s">
              <Box variant="p">
                {providerLabel} at{' '}
                <Box variant="code" display="inline">
                  {status.config?.emulator.endpoint ?? 'the configured endpoint'}
                </Box>{' '}
                does not report the{' '}
                <Box variant="code" display="inline">
                  eks
                </Box>{' '}
                service, so LocalDeck does not send EKS calls and cannot create clusters.
              </Box>
              <Box variant="p">
                EKS support depends on the emulator build; for LocalStack it is part of Pro
                (Ultimate). No LocalDeck setting changes this: LocalDeck never starts or
                reconfigures the emulator. Enable EKS in the {providerLabel} configuration, restart
                it yourself, then re-check.
              </Box>
            </SpaceBetween>
          }
          learnMore={{
            text: `${providerLabel} EKS documentation and API coverage`,
            href: docsUrl,
          }}
        />
      </ContentLayout>
    );
  }

  return (
    <>
      <ResourceListPage<EksCluster>
        title="Clusters"
        description={descriptor.summary}
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Clusters' },
        ]}
        columns={columns}
        getRowId={(cluster) => cluster.name}
        reloadToken={reloadToken}
        fetcher={fetchPage}
        filtering={{
          text: filteringText,
          onChange: setFilteringText,
          placeholder: 'Find clusters by name, status or version',
          match: (cluster, text) => {
            const needle = text.trim().toLowerCase();
            return [
              cluster.name,
              cluster.status,
              cluster.version,
              ...(cluster.arn === undefined ? [] : [cluster.arn]),
              cluster.roleArn,
            ].some((value) => value.toLowerCase().includes(needle));
          },
        }}
        headerActions={
          <Button
            variant="primary"
            onClick={() => {
              navigate(`${serviceConsolePath(descriptor.id)}/create`);
            }}
          >
            Create cluster
          </Button>
        }
        notifications={
          transitional ? (
            <Box color="text-body-secondary">
              Refreshing automatically every 10 seconds while clusters are being created, updated or
              deleted.
            </Box>
          ) : undefined
        }
        emptyTitle="No EKS clusters"
        emptyDescription={`Create a cluster to have ${providerLabel} start a Kubernetes control plane you can reach with kubectl, k9s or Headlamp.`}
      />

      {deleteTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title={`Delete cluster ${deleteTarget.name}`}
          subjects={[deleteTarget.name]}
          description={`Deleting a cluster removes its Kubernetes control plane and every node group it owns. The cluster "${deleteTarget.name}" cannot be recovered.`}
          submitLabel="Delete"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteTarget(null);
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

export default ClustersListPage;
