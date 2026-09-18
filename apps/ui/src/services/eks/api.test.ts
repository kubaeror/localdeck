import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/apiClient';
import {
  clusterStatusName,
  fromAwsTags,
  instanceBelongsToNodegroup,
  isClusterTransitional,
  isNodegroupTransitional,
  isResourceNotFound,
  kubeconfigFileName,
  kubeconfigPath,
  listClusterSummaries,
  listNodegroups,
  nodegroupStatusName,
  normalizeTags,
  toAwsTags,
  toEksCluster,
  toEksNodegroup,
} from './api';

const RAW_CLUSTER = {
  name: 'localdeck-cluster',
  arn: 'arn:aws:eks:us-east-1:000000000000:cluster/localdeck-cluster',
  status: 'ACTIVE',
  version: '1.36',
  endpoint: 'https://localhost.localstack.cloud:4513',
  roleArn: 'arn:aws:iam::000000000000:role/eks-cluster-role',
  platformVersion: 'eks.7',
  createdAt: '2026-01-02T03:04:05.000Z',
  certificateAuthority: { data: 'Y2EtZGF0YQ==' },
  identity: { oidc: { issuer: 'https://localhost.localstack.cloud/eks-oidc' } },
  resourcesVpcConfig: {
    subnetIds: ['subnet-1', 'subnet-2'],
    securityGroupIds: ['sg-1'],
    clusterSecurityGroupId: 'sg-cluster',
    vpcId: 'vpc-1',
    endpointPublicAccess: true,
    endpointPrivateAccess: false,
    publicAccessCidrs: ['0.0.0.0/0'],
  },
  kubernetesNetworkConfig: { serviceIpv4Cidr: '10.100.0.0/16' },
  tags: { env: 'test', Name: 'alpha' },
};

describe('EKS api mappers', () => {
  it('maps a raw cluster, including the VPC, tags and OIDC issuer', () => {
    const cluster = toEksCluster(RAW_CLUSTER);

    expect(cluster).toMatchObject({
      name: 'localdeck-cluster',
      status: 'ACTIVE',
      version: '1.36',
      endpoint: 'https://localhost.localstack.cloud:4513',
      roleArn: 'arn:aws:iam::000000000000:role/eks-cluster-role',
      oidcIssuer: 'https://localhost.localstack.cloud/eks-oidc',
      serviceIpv4Cidr: '10.100.0.0/16',
      vpcConfig: {
        subnetIds: ['subnet-1', 'subnet-2'],
        securityGroupIds: ['sg-1'],
        clusterSecurityGroupId: 'sg-cluster',
        vpcId: 'vpc-1',
        endpointPublicAccess: true,
        endpointPrivateAccess: false,
        publicAccessCidrs: ['0.0.0.0/0'],
      },
    });
    // Tag maps become the console's sorted AwsTag[].
    expect(cluster?.tags).toEqual([
      { Key: 'env', Value: 'test' },
      { Key: 'Name', Value: 'alpha' },
    ]);
  });

  it('returns null without a name and defaults missing collections', () => {
    expect(toEksCluster({ arn: 'arn' })).toBeNull();
    const sparse = toEksCluster({ name: 'c' });
    expect(sparse?.vpcConfig.subnetIds).toEqual([]);
    expect(sparse?.tags).toEqual([]);
    expect(sparse?.version).toBe('unknown');
  });

  it('maps a raw node group with scaling, health and ASGs', () => {
    const nodegroup = toEksNodegroup({
      nodegroupName: 'ng-1',
      nodegroupArn: 'arn:aws:eks:us-east-1:000000000000:nodegroup/c/ng-1/abc',
      clusterName: 'c',
      status: 'CREATE_FAILED',
      version: '1.36',
      instanceTypes: ['t3.medium'],
      scalingConfig: { minSize: 1, maxSize: 3, desiredSize: 2 },
      resources: { autoScalingGroups: [{ name: 'eks-ng-1-abc' }] },
      health: { issues: [{ code: 'NodeCreationFailure', message: 'nodes did not join' }] },
      tags: { team: 'platform' },
    });

    expect(nodegroup).toMatchObject({
      nodegroupName: 'ng-1',
      status: 'CREATE_FAILED',
      instanceTypes: ['t3.medium'],
      scaling: { minSize: 1, maxSize: 3, desiredSize: 2 },
      autoScalingGroups: ['eks-ng-1-abc'],
    });
    expect(nodegroup?.healthIssues[0]?.message).toBe('nodes did not join');
    expect(nodegroupStatusName(nodegroup?.status ?? '')).toBe('create-failed');
  });

  it('maps lifecycle states onto the shared status vocabulary', () => {
    expect(clusterStatusName('ACTIVE')).toBe('active');
    expect(clusterStatusName('CREATING')).toBe('creating');
    expect(clusterStatusName('DELETING')).toBe('deleting');
    expect(clusterStatusName('FAILED')).toBe('failed');
    expect(clusterStatusName('SOMETHING')).toBe('unknown');
    expect(nodegroupStatusName('DELETE_FAILED')).toBe('delete-failed');
    expect(nodegroupStatusName('DEGRADED')).toBe('degraded');
  });

  it('knows which states should keep polling', () => {
    expect(isClusterTransitional('CREATING')).toBe(true);
    expect(isClusterTransitional('UPDATING')).toBe(true);
    expect(isClusterTransitional('ACTIVE')).toBe(false);
    expect(isNodegroupTransitional('UPDATING')).toBe(true);
    expect(isNodegroupTransitional('CREATE_FAILED')).toBe(false);
  });

  it('round-trips tag maps', () => {
    const tags = [
      { Key: 'env', Value: 'test' },
      { Key: 'Name', Value: 'alpha' },
    ];
    expect(fromAwsTags(tags)).toEqual({ env: 'test', Name: 'alpha' });
    expect(toAwsTags({ env: 'test', Name: 'alpha' })).toEqual([
      { Key: 'env', Value: 'test' },
      { Key: 'Name', Value: 'alpha' },
    ]);
  });

  it('matches emulated EC2 instances to their node group by tag', () => {
    const instance = {
      name: 'i-1',
      tags: [
        { Key: 'eks:nodegroup-name', Value: 'ng-1' },
        { Key: 'eks:cluster-name', Value: 'c' },
      ],
    };
    expect(instanceBelongsToNodegroup(instance, 'ng-1')).toBe(true);
    expect(instanceBelongsToNodegroup(instance, 'NG-1')).toBe(true);
    expect(instanceBelongsToNodegroup(instance, 'ng-2')).toBe(false);
    expect(instanceBelongsToNodegroup({ name: 'ng-1', tags: [] }, 'ng-1')).toBe(true);
    expect(
      instanceBelongsToNodegroup(
        { name: 'unrelated', tags: [{ Key: 'Name', Value: 'unrelated' }] },
        'ng-1',
      ),
    ).toBe(false);
  });

  it('builds the kubeconfig download path and file name', () => {
    expect(kubeconfigPath('my cluster')).toBe('/api/eks/my%20cluster/kubeconfig');
    expect(kubeconfigFileName('my-cluster')).toBe('kubeconfig-my-cluster.yaml');
    expect(kubeconfigFileName('../../etc/passwd')).toBe('kubeconfig-etc-passwd.yaml');
    // A name with no ASCII-safe characters falls back to a fixed safe name.
    expect(kubeconfigFileName('クラスター')).toBe('kubeconfig-cluster.yaml');
  });

  it('never fabricates an ARN when LocalStack omits one', () => {
    const cluster = toEksCluster({ name: 'c' });
    const nodegroup = toEksNodegroup({ nodegroupName: 'ng' });

    expect(cluster?.arn).toBeUndefined();
    expect(nodegroup?.nodegroupArn).toBeUndefined();
  });

  it('normalizes tags (trim, drop empty keys, last duplicate wins)', () => {
    expect(
      normalizeTags([
        { Key: ' a ', Value: '1' },
        { Key: '   ', Value: 'x' },
        { Key: 'b', Value: '1' },
        { Key: 'b', Value: '2' },
      ]),
    ).toEqual([
      { Key: 'a', Value: '1' },
      { Key: 'b', Value: '2' },
    ]);
  });
});

describe('EKS list helpers error handling', () => {
  type Handler = (operation: string, input: Record<string, unknown>) => unknown;

  function stubEks(handler: Handler): void {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const match = /\/api\/services\/eks\/([^/?]+)/.exec(url);
      if (match === null) return new Response('{}', { status: 404 });
      const operation = match[1] ?? '';
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
      const result = handler(operation, body.input ?? {});
      if (typeof result === 'object' && result !== null && '__error' in result) {
        const error = (result as { __error: { code: string; message: string; statusCode: number } })
          .__error;
        return new Response(JSON.stringify({ error }), {
          status: error.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ service: 'eks', operation, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips only ResourceNotFoundException when describing clusters', async () => {
    stubEks((operation, input) => {
      if (operation === 'ListClusters') return { clusters: ['gone', 'ok'] };
      if (operation === 'DescribeCluster' && input.name === 'gone') {
        return {
          __error: { code: 'ResourceNotFoundException', message: 'gone', statusCode: 404 },
        };
      }
      if (operation === 'DescribeCluster') {
        return { cluster: { name: 'ok', status: 'ACTIVE', version: '1.36' } };
      }
      return {};
    });

    expect(
      isResourceNotFound(
        new ApiClientError({
          code: 'ResourceNotFoundException',
          message: 'gone',
          statusCode: 404,
        }),
      ),
    ).toBe(true);
    expect(
      isResourceNotFound(
        new ApiClientError({ code: 'AccessDeniedException', message: 'denied', statusCode: 403 }),
      ),
    ).toBe(false);
    const clusters = await listClusterSummaries();
    expect(clusters.map((cluster) => cluster.name)).toEqual(['ok']);
  });

  it('fails the cluster list when every describe fails with AccessDenied', async () => {
    stubEks((operation) => {
      if (operation === 'ListClusters') return { clusters: ['a', 'b'] };
      if (operation === 'DescribeCluster') {
        return { __error: { code: 'AccessDeniedException', message: 'denied', statusCode: 403 } };
      }
      return {};
    });

    await expect(listClusterSummaries()).rejects.toThrow(/denied/);
  });

  it('fails the node group list instead of rendering a false empty state', async () => {
    stubEks((operation) => {
      if (operation === 'ListNodegroups') return { nodegroups: ['ng-1'] };
      if (operation === 'DescribeNodegroup') {
        return {
          __error: { code: 'ServerException', message: 'upstream exploded', statusCode: 500 },
        };
      }
      return {};
    });

    await expect(listNodegroups('cluster')).rejects.toThrow(/upstream exploded/);
  });

  it('treats a node group deleted mid-list as gone, not as a failure', async () => {
    stubEks((operation) => {
      if (operation === 'ListNodegroups') return { nodegroups: ['ng-gone'] };
      if (operation === 'DescribeNodegroup') {
        return {
          __error: { code: 'ResourceNotFoundException', message: 'gone', statusCode: 404 },
        };
      }
      return {};
    });

    const page = await listNodegroups('cluster');
    expect(page.items).toEqual([]);
  });
});
