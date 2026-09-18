import { createServiceSpec } from '@localdeck/shared';

/**
 * EKS capability metadata.
 *
 * `operations` must stay a subset of the registry whitelist in
 * `packages/shared/src/services.ts`; `createServiceSpec` throws at module load
 * otherwise, and the api rejects anything else with 400 before the SDK runs.
 *
 * Every operation here was exercised against the running LocalStack before it
 * was whitelisted (see `live-localstack-eks.test.ts`). LocalStack manages real
 * k3d clusters behind CreateCluster (LocalStack Pro), so `CreateCluster` is a
 * genuinely long-running operation: the console never blocks on it, it polls
 * DescribeCluster until the status settles.
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
    'ListTagsForResource',
    'TagResource',
    'UntagResource',
  ],
  capabilities: { list: true, detail: true, create: true },
});

export const SERVICE_ID = spec.descriptor.id;

/** Operation the clusters list calls. */
export const LIST_OPERATION = 'ListClusters';
