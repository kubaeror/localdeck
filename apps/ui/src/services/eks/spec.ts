import { createServiceSpec } from '@localdeck/shared';

/**
 * EKS capability metadata.
 *
 * `operations` must stay a subset of the registry whitelist in
 * `packages/shared/src/services.ts`; `createServiceSpec` throws at module load
 * otherwise, and the api rejects anything else with 400 before the SDK runs.
 *
 * Verification status against the running LocalStack:
 * - `live-localstack-eks.test.ts` always covers DescribeClusterVersions and
 *   ListClusters; with `VITE_LIVEDECK_LIVE_EKS_CREATE=1` it additionally drives
 *   CreateCluster → DescribeCluster → CreateNodegroup → UpdateNodegroupConfig
 *   → TagResource/UntagResource → DeleteNodegroup → DeleteCluster. When
 *   LocalStack's k3d provider cannot start the cluster (the test then asserts
 *   the FAILED terminal state and cleans up), the node group and tag steps are
 *   skipped by design; the tag round-trip is also verified directly against a
 *   cluster whose k3d control plane failed, because EKS stores tags
 *   independently of the control plane.
 * - Operations the real console offers but LocalDeck does not call are rendered
 *   disabled with the reason instead of being silently absent (see
 *   ClusterDetail and NodegroupsTab): UpdateClusterVersion,
 *   UpdateNodegroupVersion, Fargate profiles and add-ons.
 *
 * LocalStack manages real k3d clusters behind CreateCluster (LocalStack Pro),
 * so `CreateCluster` is a genuinely long-running operation: the console never
 * blocks on it, it polls DescribeCluster until the status settles.
 */
export const spec = createServiceSpec('eks', {
  operations: [
    // Clusters
    'ListClusters',
    'DescribeCluster',
    'CreateCluster',
    'DeleteCluster',
    'DescribeClusterVersions',
    // Managed node groups
    'ListNodegroups',
    'DescribeNodegroup',
    'CreateNodegroup',
    'UpdateNodegroupConfig',
    'DeleteNodegroup',
    // Tags (clusters and node groups share the ARN-keyed tag API)
    'TagResource',
    'UntagResource',
  ],
  capabilities: { list: true, detail: true, create: true },
});

export const SERVICE_ID = spec.descriptor.id;

/** Operation the clusters list calls. */
export const LIST_OPERATION = 'ListClusters';
