import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import { listAllInstances, type Ec2Instance } from '../../ec2/api';
import { serviceConsolePath } from '../../paths';
import {
  deleteNodegroup,
  filterNodegroupInstances,
  isNodegroupTransitional,
  nodegroupStatusName,
  listNodegroups,
  type EksCluster,
  type EksNodegroup,
} from '../api';
import { toFriendlyEksError } from '../errors';
import { CreateNodegroupModal } from './CreateNodegroupModal';
import { UpdateScalingModal } from './UpdateScalingModal';

/** How often the Compute tab refreshes while a node group is still settling. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Operations the real EKS console offers but LocalDeck does not call yet,
 * because they are not whitelisted/verified against the running LocalStack.
 * They are rendered disabled with the reason instead of being hidden.
 */
const UPDATE_VERSION_REASON =
  'UpdateNodegroupVersion is not whitelisted in LocalDeck yet, so the Kubernetes version of a node group cannot be changed here.';
const FARGATE_REASON =
  'Fargate profiles are not whitelisted in LocalDeck yet (CreateFargateProfile is not verified against LocalStack).';
const ADDON_REASON =
  'EKS add-ons are not whitelisted in LocalDeck yet (CreateAddon is not verified against LocalStack).';

/**
 * EKS only accepts DeleteNodegroup while the node group is settled. Deleting a
 * CREATING/UPDATING group is rejected upstream, so the action is disabled with
 * the allowed states instead of failing after the click.
 */
const DELETE_REASON =
  'EKS only deletes a node group whose status is ACTIVE, CREATE_FAILED or DEGRADED. Wait for the current operation to finish.';

/** The statuses EKS accepts DeleteNodegroup for. */
function canDeleteNodegroup(status: string): boolean {
  return status === 'ACTIVE' || status === 'CREATE_FAILED' || status === 'DEGRADED';
}

export interface NodegroupsTabProps {
  cluster: EksCluster;
}

/** "1/2/1" — the AWS console's min/max/desired shorthand. */
function formatScaling(nodegroup: EksNodegroup): string {
  const { minSize, maxSize, desiredSize } = nodegroup.scaling;
  return `${minSize ?? '—'}/${maxSize ?? '—'}/${desiredSize ?? '—'}`;
}

/** Every health issue the service reported, not only the first one. */
function healthIssueText(nodegroup: EksNodegroup): string | null {
  if (nodegroup.healthIssues.length === 0) return null;
  return nodegroup.healthIssues
    .map((issue) => issue.message ?? `Health issue: ${issue.code ?? 'unknown'}`)
    .join('; ');
}

/**
 * The cluster's Compute tab: managed node groups with their status, instance
 * types and scaling configuration, in-place scaling, create/delete, and deep
 * links to the emulated EC2 instances LocalStack provisions for the nodes.
 *
 * LocalStack creates and deletes node groups asynchronously (k3d agents in
 * Docker), so the table polls DescribeNodegroup while anything is in a
 * transitional state and reports the transitions through the app flashbar.
 * The emulated EC2 instances behind the nodes are fetched once per cluster and
 * then only when a node group status actually changes, so the periodic poll
 * does not walk the whole EC2 instance list every 10 seconds.
 */
export function NodegroupsTab({ cluster }: NodegroupsTabProps): ReactElement {
  const navigate = useNavigate();
  // Only `notify` is taken from the context: the context value changes whenever
  // a message appears, and depending on the whole object would restart the
  // loader (and the poll) on every notification.
  const { notify } = useFlashbar();

  const [nodegroups, setNodegroups] = useState<readonly EksNodegroup[]>([]);
  const [instances, setInstances] = useState<readonly Ec2Instance[]>([]);
  const [instancesError, setInstancesError] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [scalingTarget, setScalingTarget] = useState<EksNodegroup | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<EksNodegroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sortingColumn, setSortingColumn] = useState<
    TableProps.SortingColumn<EksNodegroup> | undefined
  >(undefined);
  const [sortingDescending, setSortingDescending] = useState(false);

  /** Last status seen per node group, so transitions can be announced once. */
  const previousStatus = useRef(new Map<string, string>());
  /** Node groups the user asked to delete; announced when they disappear. */
  const pendingDelete = useRef(new Set<string>());
  /** Status signature the currently loaded EC2 instances belong to. */
  const instanceSignature = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const instancesInFlight = useRef(0);

  const loadInstances = useCallback(async (): Promise<void> => {
    const request = instancesInFlight.current + 1;
    instancesInFlight.current = request;
    try {
      const result = await listAllInstances();
      if (instancesInFlight.current !== request) return;
      setInstances(result);
      setInstancesError(null);
    } catch (caught) {
      if (instancesInFlight.current !== request) return;
      setInstances([]);
      setInstancesError(toApiError(caught));
    }
  }, []);

  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<void> => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (options.silent !== true) {
        setPhase((current) => (current === 'ready' ? current : 'loading'));
      }
      try {
        const page = await listNodegroups(cluster.name, controller.signal);
        if (controller.signal.aborted) return;

        // Announce lifecycle transitions the user is waiting on.
        const seen = new Set(page.items.map((nodegroup) => nodegroup.nodegroupName));
        for (const nodegroup of page.items) {
          const previous = previousStatus.current.get(nodegroup.nodegroupName);
          previousStatus.current.set(nodegroup.nodegroupName, nodegroup.status);
          if (previous === undefined || previous === nodegroup.status) continue;
          if (nodegroup.status === 'ACTIVE') {
            notify({
              type: 'success',
              header: `Node group ${nodegroup.nodegroupName} is active`,
              content: `${nodegroup.instanceTypes.join(', ') || 'Default instance type'} · ${formatScaling(nodegroup)} (min/max/desired)`,
            });
          } else if (
            nodegroup.status === 'CREATE_FAILED' ||
            nodegroup.status === 'DELETE_FAILED' ||
            nodegroup.status === 'DEGRADED'
          ) {
            notify({
              type: 'error',
              header: `Node group ${nodegroup.nodegroupName} is ${nodegroup.status.toLowerCase().replace(/_/g, ' ')}`,
              content:
                healthIssueText(nodegroup) ??
                'LocalStack reported a failure for this node group. Open it in the table for details.',
            });
          }
        }
        for (const name of [...pendingDelete.current]) {
          if (seen.has(name)) continue;
          pendingDelete.current.delete(name);
          previousStatus.current.delete(name);
          notify({
            type: 'success',
            header: `Node group ${name} deleted`,
            content: cluster.name,
          });
        }

        // Scaling or a lifecycle transition can change the emulated EC2
        // instances; a plain poll with unchanged statuses must not.
        const signature = page.items
          .map((nodegroup) => `${nodegroup.nodegroupName}:${nodegroup.status}`)
          .sort()
          .join('|');
        const previousSignature = instanceSignature.current;
        instanceSignature.current = signature;
        if (previousSignature !== null && previousSignature !== signature) {
          void loadInstances();
        }

        setNodegroups(page.items);
        setError(null);
        setPhase('ready');
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toApiError(caught));
        setPhase('error');
      }
    },
    [cluster.name, loadInstances, notify],
  );

  // Reset the announcement state when the tab is re-pointed at another cluster
  // (the component instance can be reused; ClusterDetail also keys it by name).
  useEffect(() => {
    previousStatus.current = new Map();
    pendingDelete.current = new Set();
    instanceSignature.current = null;
  }, [cluster.name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- node group lookup for the tab
    void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load, reloadToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- EC2 deep-link catalogue
    void loadInstances();
    return () => {
      instancesInFlight.current += 1;
    };
  }, [loadInstances, cluster.name, reloadToken]);

  const transitional = nodegroups.some((nodegroup) => isNodegroupTransitional(nodegroup.status));

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    void load({ silent: true });
  });

  const instancesFor = useCallback(
    (nodegroup: EksNodegroup): readonly Ec2Instance[] =>
      filterNodegroupInstances(instances, cluster.name, nodegroup.nodegroupName),
    [cluster.name, instances],
  );

  const openInstance = useCallback(
    (instanceId: string) => {
      void navigate(`${serviceConsolePath('ec2')}/instances/${encodeURIComponent(instanceId)}`);
    },
    [navigate],
  );

  const confirmDelete = async (): Promise<void> => {
    if (deletingTarget === null) return;
    const name = deletingTarget.nodegroupName;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteNodegroup(cluster.name, name);
      pendingDelete.current.add(name);
      notify({
        type: 'info',
        header: `Deleting node group ${name}`,
        content: 'LocalStack is removing the k3d agents and their emulated EC2 instances.',
      });
      setDeletingTarget(null);
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setDeleteError(toFriendlyEksError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo<readonly TableProps.ColumnDefinition<EksNodegroup>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        sortingField: 'nodegroupName',
        isRowHeader: true,
        cell: (nodegroup) => nodegroup.nodegroupName,
      },
      {
        id: 'status',
        header: 'Status',
        sortingField: 'status',
        cell: (nodegroup) => {
          const issue = healthIssueText(nodegroup);
          return (
            <SpaceBetween size="xxs">
              <StatusBadge status={nodegroupStatusName(nodegroup.status)} />
              {issue === null ? null : (
                <Box variant="small" color="text-status-error">
                  {issue}
                </Box>
              )}
            </SpaceBetween>
          );
        },
      },
      {
        id: 'instanceTypes',
        header: 'Instance types',
        sortingField: 'instanceTypes',
        cell: (nodegroup) =>
          nodegroup.instanceTypes.length === 0 ? (
            '—'
          ) : (
            <Box variant="code">{nodegroup.instanceTypes.join(', ')}</Box>
          ),
      },
      {
        id: 'scaling',
        header: 'Min/Max/Desired',
        cell: (nodegroup) => <Box variant="code">{formatScaling(nodegroup)}</Box>,
      },
      {
        id: 'capacityType',
        header: 'Capacity type',
        cell: (nodegroup) => nodegroup.capacityType ?? 'ON_DEMAND',
      },
      {
        id: 'version',
        header: 'Kubernetes version',
        sortingField: 'version',
        cell: (nodegroup) => nodegroup.version ?? '—',
      },
      {
        id: 'createdAt',
        header: 'Created',
        sortingField: 'createdAt',
        cell: (nodegroup) => formatDateTime(nodegroup.createdAt),
      },
      {
        id: 'ec2',
        header: 'Emulated EC2 instances',
        cell: (nodegroup) => {
          if (instancesError !== null) {
            return <Box color="text-status-warning">Lookup failed</Box>;
          }
          const matches = instancesFor(nodegroup);
          if (matches.length === 0) {
            return (
              <Box color="text-body-secondary">
                {isNodegroupTransitional(nodegroup.status) ? 'Provisioning…' : 'None reported'}
              </Box>
            );
          }
          return (
            <SpaceBetween size="xxs">
              {matches.slice(0, 4).map((instance) => (
                <Link
                  key={instance.instanceId}
                  href={`${serviceConsolePath('ec2')}/instances/${encodeURIComponent(instance.instanceId)}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    openInstance(instance.instanceId);
                  }}
                >
                  <Box variant="code" display="inline">
                    {instance.name ?? instance.instanceId}
                  </Box>
                </Link>
              ))}
              {matches.length > 4 ? (
                <Box variant="small" color="text-body-secondary">
                  …and {matches.length - 4} more
                </Box>
              ) : null}
            </SpaceBetween>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: (nodegroup) => (
          <ButtonDropdown
            variant="icon"
            ariaLabel={`Actions for ${nodegroup.nodegroupName}`}
            items={[
              { id: 'scaling', text: 'Edit scaling' },
              {
                id: 'update-version',
                text: 'Change Kubernetes version',
                disabled: true,
                disabledReason: UPDATE_VERSION_REASON,
              },
              {
                id: 'delete',
                text: 'Delete',
                disabled: !canDeleteNodegroup(nodegroup.status),
                disabledReason: DELETE_REASON,
              },
            ]}
            onItemClick={({ detail }) => {
              if (detail.id === 'scaling') setScalingTarget(nodegroup);
              if (detail.id === 'delete') {
                setDeleteError(null);
                setDeletingTarget(nodegroup);
              }
            }}
          />
        ),
      },
    ],
    [instancesError, instancesFor, openInstance],
  );

  const header = (
    <Header
      variant="h2"
      counter={`(${nodegroups.length})`}
      description="Managed node groups run one k3d agent per desired node and register an emulated EC2 instance for each."
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          <ButtonDropdown
            items={[
              {
                id: 'fargate',
                text: 'Create Fargate profile',
                disabled: true,
                disabledReason: FARGATE_REASON,
              },
              {
                id: 'addon',
                text: 'Create add-on',
                disabled: true,
                disabledReason: ADDON_REASON,
              },
            ]}
            onItemClick={() => undefined}
          >
            More
          </ButtonDropdown>
          <Button
            iconName="refresh"
            ariaLabel="Refresh node groups"
            loading={phase === 'loading'}
            onClick={() => {
              setReloadToken((token) => token + 1);
            }}
          />
          <Button
            variant="primary"
            disabled={cluster.status !== 'ACTIVE'}
            onClick={() => {
              setCreating(true);
            }}
          >
            Create node group
          </Button>
        </SpaceBetween>
      }
    >
      Node groups
    </Header>
  );

  return (
    <>
      <SpaceBetween size="m">
        {error === null ? null : (
          <Alert
            type="error"
            header="Could not load the node groups"
            action={
              <Button
                onClick={() => {
                  setReloadToken((token) => token + 1);
                }}
              >
                Retry
              </Button>
            }
          >
            {error.message}
          </Alert>
        )}

        {cluster.status === 'ACTIVE' ? null : (
          <Alert type="info">
            Node groups can only be created once the cluster is ACTIVE. {cluster.name} is currently{' '}
            {cluster.status}.
          </Alert>
        )}

        {instancesError === null ? null : (
          <Alert
            type="warning"
            header="Could not load the emulated EC2 instances"
            action={
              <Button
                onClick={() => {
                  void loadInstances();
                }}
              >
                Retry
              </Button>
            }
          >
            The node groups loaded, but the EC2 instance lookup behind the "Emulated EC2 instances"
            column failed: {instancesError.message} The column shows "Lookup failed" instead of
            pretending there are no instances.
          </Alert>
        )}

        <Container header={header}>
          <Table<EksNodegroup>
            variant="embedded"
            loading={phase === 'loading'}
            loadingText="Loading node groups"
            items={[...nodegroups]}
            columnDefinitions={columns}
            trackBy={(nodegroup) => nodegroup.nodegroupName}
            sortingColumn={sortingColumn}
            sortingDescending={sortingDescending}
            onSortingChange={({ detail }) => {
              setSortingColumn(detail.sortingColumn);
              setSortingDescending(detail.isDescending === true);
            }}
            ariaLabels={{ tableLabel: 'Node groups', selectionGroupLabel: 'Node group selection' }}
            empty={
              <Box textAlign="center" color="text-body-secondary">
                No node groups. The cluster has no worker nodes until you create one.
              </Box>
            }
            header={
              transitional ? (
                <Box color="text-body-secondary">
                  Refreshing automatically every 10 seconds while node groups are being created,
                  updated or deleted.
                </Box>
              ) : undefined
            }
          />
        </Container>
      </SpaceBetween>

      {creating ? (
        <CreateNodegroupModal
          visible
          cluster={cluster}
          onDismiss={() => {
            setCreating(false);
          }}
          onCreated={(nodegroup) => {
            setCreating(false);
            previousStatus.current.set(nodegroup.nodegroupName, 'CREATING');
            notify({
              type: 'info',
              header: `Creating node group ${nodegroup.nodegroupName}`,
              content: 'LocalStack is starting the k3d agents. This usually takes a minute or two.',
            });
            setReloadToken((token) => token + 1);
          }}
        />
      ) : null}

      {scalingTarget === null ? null : (
        <UpdateScalingModal
          visible
          cluster={cluster}
          nodegroup={scalingTarget}
          onDismiss={() => {
            setScalingTarget(null);
          }}
          onUpdated={(nodegroup) => {
            setScalingTarget(null);
            previousStatus.current.set(nodegroup.nodegroupName, nodegroup.status);
            notify({
              type: 'info',
              header: `Updating ${nodegroup.nodegroupName}`,
              content: `Scaling configuration is now ${formatScaling(nodegroup)} (min/max/desired).`,
            });
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {deletingTarget === null ? null : (
        <DeleteConfirmModal
          visible
          title={`Delete node group ${deletingTarget.nodegroupName}`}
          subjects={[deletingTarget.nodegroupName]}
          description={`Deleting a node group removes its k3d agents and the emulated EC2 instances behind them. Workloads on those nodes are evicted. The node group "${deletingTarget.nodegroupName}" cannot be recovered.`}
          submitLabel="Delete"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeletingTarget(null);
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

export default NodegroupsTab;
