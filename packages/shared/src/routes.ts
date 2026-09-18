/**
 * Canonical paths served by the LocalDeck api. Kept in the shared package so
 * the api (which registers them) and the ui (which calls them) cannot drift.
 */
export const API_PATHS = {
  config: '/api/config',
  health: '/api/health',
  liveness: '/api/health/live',
  services: '/api/services',
  serviceOperations: '/api/services/:serviceId/operations',
  serviceOperation: '/api/services/:serviceId/:operation',
  eksKubeconfig: '/api/eks/:cluster/kubeconfig',
} as const;

/**
 * Path of the dynamic service dispatcher: one route that proxies any
 * whitelisted operation of any registered service.
 */
export function serviceOperationPath(serviceId: string, operation: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/${encodeURIComponent(operation)}`;
}

/**
 * Path of the downloadable kubeconfig for one EKS cluster. The api builds the
 * YAML from DescribeCluster (endpoint and certificate authority), so the file
 * always matches the cluster the console is looking at.
 */
export function eksKubeconfigPath(clusterName: string): string {
  return `/api/eks/${encodeURIComponent(clusterName)}/kubeconfig`;
}
