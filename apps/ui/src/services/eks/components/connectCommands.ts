import { kubeconfigFileName } from '../api';

/**
 * Quotes one value for a POSIX shell: wraps it in single quotes and escapes
 * embedded single quotes as `'\''`. Cluster names can contain characters a
 * user copy-pastes (or that an attacker chose outside LocalDeck), so nothing
 * is interpolated into a command unquoted.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Where the endpoint, credentials and region come from for kubectl. */
export function kubeconfigCommands(clusterName: string, endpoint: string, region: string): string {
  return [
    '# 1. Download the kubeconfig (button above), then point kubectl at it',
    `export KUBECONFIG=~/Downloads/${shellQuote(kubeconfigFileName(clusterName))}`,
    '',
    '# 2. Let the kubeconfig credential plugin reach LocalStack',
    `export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=${shellQuote(region)}`,
    `export AWS_ENDPOINT_URL=${shellQuote(endpoint)}   # your LOCALSTACK_ENDPOINT`,
    '',
    '# 3. Talk to the cluster',
    'kubectl get nodes',
    '',
    '# 4. Terminal UI or dashboard on top of the same kubeconfig',
    'k9s',
    'headlamp',
  ].join('\n');
}
