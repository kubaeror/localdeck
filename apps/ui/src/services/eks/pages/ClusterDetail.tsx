import type { ApiError } from '@localdeck/shared';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeleteConfirmModal } from '../../../components/DeleteConfirmModal';
import { ResourceDetailPage } from '../../../components/ResourceDetailPage';
import { StatusBadge } from '../../../components/StatusBadge';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { usePolling } from '../../../hooks/usePolling';
import { toApiError } from '../../../lib/apiClient';
import { formatDateTime } from '../../../lib/format';
import { LOCALSTACK_SERVICES_DOCS_URL, serviceConsolePath } from '../../paths';
import type { ServicePageProps } from '../../types';
import {
  clusterStatusName,
  deleteCluster,
  getCluster,
  isClusterTransitional,
  type EksCluster,
} from '../api';
import { toFriendlyEksError } from '../errors';
import { ClusterTagsTab } from '../components/ClusterTagsTab';
import { ConnectLocally } from '../components/ConnectLocally';
import { NodegroupsTab } from '../components/NodegroupsTab';

/**
 * How often the page refreshes while the cluster is still settling. LocalStack
 * starts a real k3d cluster during CREATE, which takes minutes; polling is the
 * only way to observe that without blocking.
 */
const POLL_INTERVAL_MS = 5_000;

/** What LocalStack's k3d provider needs, in console wording. */
const K3D_TROUBLESHOOTING: readonly string[] = [
  'Docker must be reachable from the LocalStack container (the Docker socket is mounted).',
  'The k3d API port must be reachable from LocalStack: on Linux/WSL, add host.docker.internal:host-gateway to the LocalStack container.',
  'An old ~/.kube/config mounted into LocalStack can make EKS think you want to use an existing cluster.',
];

/**
 * One EKS cluster: Overview / Compute (node groups) / Tags. While the cluster
 * is CREATING or UPDATING the page polls DescribeCluster every 5 seconds and
 * announces the transition (ACTIVE or FAILED) through the flashbar; a failed
 * cluster renders LocalStack-specific guidance instead of a stack trace.
 */
export function ClusterDetailPage({ descriptor }: ServicePageProps): ReactElement {
  const { clusterName = '' } = useParams();
  const navigate = useNavigate();
  const flashbar = useFlashbar();

  const [cluster, setCluster] = useState<EksCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const previousStatus = useRef<string | null>(null);
  const requestId = useRef(0);

  const announce = useCallback(
    (next: EksCluster, previous: string | null): void => {
      if (previous === null || previous === next.status) return;
      if (next.status === 'ACTIVE' && previous === 'CREATING') {
        flashbar.notify({
          type: 'success',
          header: `Cluster ${next.name} is active`,
          content:
            next.endpoint === undefined
              ? 'LocalStack finished starting the k3d control plane.'
              : `Kubernetes API endpoint: ${next.endpoint}`,
        });
      } else if (next.status === 'FAILED') {
        flashbar.notify({
          type: 'error',
          header: `Cluster ${next.name} failed to start`,
          content:
            "LocalStack could not start the k3d cluster. Check LocalStack's logs and the k3d requirements below, then delete this cluster and create it again.",
        });
      }
    },
    [flashbar],
  );

  const load = useCallback(
    async (options: { silent?: boolean } = {}): Promise<void> => {
      const id = requestId.current + 1;
      requestId.current = id;
      if (options.silent !== true) setLoading(true);
      try {
        const result = await getCluster(clusterName);
        if (requestId.current !== id) return;
        announce(result, previousStatus.current);
        previousStatus.current = result.status;
        setCluster(result);
        setError(null);
      } catch (caught) {
        if (requestId.current !== id) return;
        setCluster(null);
        setError(toApiError(caught));
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    },
    [announce, clusterName],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cluster lookup for the route
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const transitional = cluster !== null && isClusterTransitional(cluster.status);

  usePolling(transitional, POLL_INTERVAL_MS, () => {
    void load({ silent: true });
  });

  const confirmDelete = async (): Promise<void> => {
    if (cluster === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCluster(cluster.name);
      flashbar.notify({
        type: 'info',
        header: `Deleting cluster ${cluster.name}`,
        content: 'LocalStack is tearing down the k3d cluster.',
      });
      setDeleteOpen(false);
      navigate(serviceConsolePath(descriptor.id));
    } catch (caught) {
      setDeleteError(toFriendlyEksError(caught).message);
    } finally {
      setDeleting(false);
    }
  };

  const overview = useMemo(() => {
    if (cluster === null) return null;
    return (
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">Cluster configuration</Header>}>
          <KeyValuePairs
            columns={3}
            items={[
              { label: 'Name', value: cluster.name },
              { label: 'ARN', value: <Box variant="code">{cluster.arn}</Box> },
              {
                label: 'Status',
                value: <StatusBadge status={clusterStatusName(cluster.status)} />,
              },
              { label: 'Kubernetes version', value: cluster.version },
              { label: 'Platform version', value: cluster.platformVersion ?? '—' },
              { label: 'Created', value: formatDateTime(cluster.createdAt) },
              {
                label: 'Kubernetes API endpoint',
                value:
                  cluster.endpoint === undefined ? (
                    '—'
                  ) : (
                    <Box variant="code">{cluster.endpoint}</Box>
                  ),
              },
              { label: 'Cluster IAM role', value: <Box variant="code">{cluster.roleArn}</Box> },
              { label: 'Service IPv4 CIDR', value: cluster.serviceIpv4Cidr ?? '—' },
              { label: 'VPC', value: cluster.vpcConfig.vpcId ?? '—' },
              {
                label: 'Subnets',
                value:
                  cluster.vpcConfig.subnetIds.length === 0 ? (
                    '—'
                  ) : (
                    <Box variant="code">{cluster.vpcConfig.subnetIds.join(', ')}</Box>
                  ),
              },
              {
                label: 'Security groups',
                value:
                  cluster.vpcConfig.securityGroupIds.length === 0 ? (
                    '—'
                  ) : (
                    <Box variant="code">{cluster.vpcConfig.securityGroupIds.join(', ')}</Box>
                  ),
              },
              {
                label: 'Cluster security group',
                value:
                  cluster.vpcConfig.clusterSecurityGroupId === undefined ? (
                    '—'
                  ) : (
                    <Box variant="code">{cluster.vpcConfig.clusterSecurityGroupId}</Box>
                  ),
              },
              {
                label: 'Endpoint access',
                value:
                  [
                    cluster.vpcConfig.endpointPublicAccess ? 'Public' : undefined,
                    cluster.vpcConfig.endpointPrivateAccess ? 'Private' : undefined,
                  ]
                    .filter((part): part is string => part !== undefined)
                    .join(' and ') || '—',
              },
              {
                label: 'Public access CIDRs',
                value:
                  cluster.vpcConfig.endpointPublicAccess &&
                  cluster.vpcConfig.publicAccessCidrs.length > 0
                    ? cluster.vpcConfig.publicAccessCidrs.join(', ')
                    : '—',
              },
              {
                label: 'OIDC issuer',
                value:
                  cluster.oidcIssuer === undefined ? (
                    '—'
                  ) : (
                    <Box variant="code">{cluster.oidcIssuer}</Box>
                  ),
              },
            ]}
          />
        </Container>

        <ConnectLocally cluster={cluster} />
      </SpaceBetween>
    );
  }, [cluster]);

  const failed = cluster !== null && cluster.status === 'FAILED';

  return (
    <>
      <ResourceDetailPage
        title={clusterName}
        description={
          cluster === null ? (
            descriptor.summary
          ) : (
            <SpaceBetween direction="horizontal" size="xs">
              <Box variant="code" display="inline">
                {cluster.arn}
              </Box>
              <Box display="inline" color="text-body-secondary">
                · Kubernetes {cluster.version}
              </Box>
            </SpaceBetween>
          )
        }
        breadcrumbs={[
          { text: descriptor.displayName, href: serviceConsolePath(descriptor.id) },
          { text: 'Clusters', href: serviceConsolePath(descriptor.id) },
          { text: clusterName },
        ]}
        loading={loading && cluster === null}
        error={cluster === null ? error : null}
        onRetry={() => {
          void load();
        }}
        status={
          cluster === null ? undefined : <StatusBadge status={clusterStatusName(cluster.status)} />
        }
        headerActions={
          cluster === null ? undefined : (
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh cluster"
                loading={loading && cluster !== null}
                onClick={() => {
                  void load();
                }}
              />
              <Button
                disabled={!['ACTIVE', 'FAILED'].includes(cluster.status)}
                onClick={() => {
                  setDeleteError(null);
                  setDeleteOpen(true);
                }}
              >
                Delete
              </Button>
            </SpaceBetween>
          )
        }
        notifications={
          cluster === null ? undefined : (
            <SpaceBetween size="m">
              {isClusterTransitional(cluster.status) ? (
                <Alert
                  type="info"
                  header={`Cluster ${cluster.name} is ${cluster.status.toLowerCase()}`}
                >
                  LocalStack is {cluster.status === 'CREATING' ? 'starting' : 'updating'} a real k3d
                  Kubernetes control plane in Docker. This can take several minutes. The page
                  refreshes every 5 seconds and reports the result through notifications; you can
                  leave it and come back.
                </Alert>
              ) : null}

              {failed ? (
                <Alert
                  type="error"
                  header="LocalStack could not start this cluster"
                  action={
                    <Button
                      href={LOCALSTACK_SERVICES_DOCS_URL}
                      target="_blank"
                      external
                      iconAlign="right"
                      iconName="external"
                    >
                      Troubleshooting
                    </Button>
                  }
                >
                  <SpaceBetween size="xs">
                    <Box variant="p">
                      DescribeCluster reports the cluster as FAILED. LocalStack creates EKS clusters
                      with k3d, so the failure is in the container infrastructure it manages — not
                      in LocalDeck, and not something LocalDeck can repair for you.
                    </Box>
                    <Box variant="p">Things to check in your LocalStack environment:</Box>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      {K3D_TROUBLESHOOTING.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <Box variant="p">
                      Delete this cluster, fix the environment, and create it again. LocalStack logs
                      contain the underlying k3d error.
                    </Box>
                  </SpaceBetween>
                </Alert>
              ) : null}
            </SpaceBetween>
          )
        }
        tabs={
          cluster === null
            ? []
            : [
                { id: 'overview', label: 'Overview', content: overview },
                {
                  id: 'compute',
                  label: 'Compute',
                  content: <NodegroupsTab cluster={cluster} />,
                },
                {
                  id: 'tags',
                  label: 'Tags',
                  content: (
                    <ClusterTagsTab
                      key={cluster.arn}
                      cluster={cluster}
                      onSaved={() => {
                        void load({ silent: true });
                      }}
                    />
                  ),
                },
              ]
        }
      />

      {deleteOpen && cluster !== null ? (
        <DeleteConfirmModal
          visible
          title={`Delete cluster ${cluster.name}`}
          subjects={[cluster.name]}
          description={`Deleting a cluster removes its k3d control plane and every node group it owns. The cluster "${cluster.name}" cannot be recovered.`}
          submitLabel="Delete"
          loading={deleting}
          {...(deleteError === null ? {} : { errorText: deleteError })}
          onDismiss={() => {
            if (deleting) return;
            setDeleteOpen(false);
            setDeleteError(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
        />
      ) : null}
    </>
  );
}

export default ClusterDetailPage;
