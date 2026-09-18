/**
 * kubeconfig generation for EKS.
 *
 * LocalStack exposes each ACTIVE cluster through the `endpoint` and
 * `certificateAuthority.data` members of DescribeCluster, exactly like AWS
 * does. The `aws eks update-kubeconfig` CLI command turns those into a
 * kubeconfig whose user entry runs `aws eks get-token`; this builder produces
 * the same document, with LocalStack's endpoint added to the credential
 * plugin's environment so kubectl talks to the emulator even when the shell
 * has no LocalStack profile configured.
 */

/** One cluster as DescribeCluster reports it, narrowed to what a kubeconfig needs. */
export interface KubeconfigCluster {
  name: string;
  /** Cluster ARN, used as the kubeconfig cluster/context/user name like the AWS CLI does. */
  arn: string;
  /** Kubernetes API server endpoint (`https://…`). */
  endpoint: string;
  /** Base64-encoded certificate authority bundle. */
  certificateAuthorityData: string;
}

export interface BuildKubeconfigInput {
  cluster: KubeconfigCluster;
  /** Region the token plugin signs for. */
  region: string;
  /**
   * LocalStack endpoint the token plugin should call. Use the *public*
   * endpoint (`LOCALSTACK_PUBLIC_ENDPOINT`) when the file is executed outside
   * the api container: `host.docker.internal` does not resolve on Linux hosts.
   *
   * The exec plugin relies on `AWS_ENDPOINT_URL`, which only AWS CLI v2 honors.
   * AWS CLI v1 ignores it and would sign against real AWS with the caller's
   * credentials, so the console documents CLI v2 as a requirement.
   */
  emulatorEndpoint: string;
  /**
   * The CLI profile the token plugin should use, when the caller has one.
   * Without it `aws eks get-token` uses the default credential chain.
   */
  profile?: string;
}

/**
 * YAML double-quoted scalar. JSON.stringify is used deliberately: its output
 * is a valid YAML double-quoted scalar and it escapes control characters
 * (newlines, tabs) that a hand-rolled backslash/quote escape would let through,
 * which could otherwise corrupt or inject into the generated document.
 */
function quote(value: string): string {
  return JSON.stringify(value);
}

/** `kubeconfig-<cluster>.yaml`, safe for a Content-Disposition header. */
export function kubeconfigFileName(clusterName: string): string {
  const safe = clusterName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return `kubeconfig-${safe.length === 0 ? 'cluster' : safe}.yaml`;
}

/**
 * Builds the kubeconfig YAML for one cluster. The auth stanza mirrors the AWS
 * CLI: `aws eks get-token` with `--cluster-name`, pinned to the configured
 * region and LocalStack endpoint.
 */
export function buildKubeconfig(input: BuildKubeconfigInput): string {
  const { cluster, region, emulatorEndpoint, profile } = input;
  const contextName = cluster.arn.length > 0 ? cluster.arn : cluster.name;
  const lines: string[] = [
    'apiVersion: v1',
    'clusters:',
    '  - name: ' + quote(contextName),
    '    cluster:',
    '      server: ' + quote(cluster.endpoint),
    '      certificate-authority-data: ' + quote(cluster.certificateAuthorityData),
    'contexts:',
    '  - name: ' + quote(contextName),
    '    context:',
    '      cluster: ' + quote(contextName),
    '      user: ' + quote(contextName),
    'current-context: ' + quote(contextName),
    'kind: Config',
    'preferences: {}',
    'users:',
    '  - name: ' + quote(contextName),
    '    user:',
    '      exec:',
    '        apiVersion: client.authentication.k8s.io/v1beta1',
    '        command: aws',
    '        args:',
    '          - --region',
    '          - ' + quote(region),
    '          - eks',
    '          - get-token',
    '          - --cluster-name',
    '          - ' + quote(cluster.name),
    '          - --output',
    '          - json',
    '        env:',
    '          - name: AWS_ENDPOINT_URL',
    '            value: ' + quote(emulatorEndpoint),
    '          - name: AWS_DEFAULT_REGION',
    '            value: ' + quote(region),
    ...(profile === undefined || profile.length === 0
      ? []
      : ['          - name: AWS_PROFILE', '            value: ' + quote(profile)]),
    '        interactiveMode: IfAvailable',
    '        provideClusterInfo: false',
  ];
  return `${lines.join('\n')}\n`;
}
