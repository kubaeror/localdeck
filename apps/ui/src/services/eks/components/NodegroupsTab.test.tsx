// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import type { EksCluster } from '../api';
import { NodegroupsTab } from './NodegroupsTab';

const CLUSTER: EksCluster = {
  name: 'localdeck-cluster',
  arn: 'arn:aws:eks:us-east-1:000000000000:cluster/localdeck-cluster',
  status: 'ACTIVE',
  version: '1.36',
  endpoint: 'https://localhost.localstack.cloud:4513',
  roleArn: 'arn:aws:iam::000000000000:role/eks-role',
  vpcConfig: {
    subnetIds: ['subnet-1', 'subnet-2'],
    securityGroupIds: [],
    endpointPublicAccess: true,
    endpointPrivateAccess: false,
    publicAccessCidrs: ['0.0.0.0/0'],
  },
  tags: [],
  raw: {},
};

const LIST_NODEGROUPS = {
  service: 'eks',
  operation: 'ListNodegroups',
  result: { nodegroups: ['ng-workers'] },
};

const DESCRIBE_NODEGROUP = {
  service: 'eks',
  operation: 'DescribeNodegroup',
  result: {
    nodegroup: {
      nodegroupName: 'ng-workers',
      nodegroupArn: 'arn:aws:eks:us-east-1:000000000000:nodegroup/localdeck-cluster/ng-workers/abc',
      clusterName: 'localdeck-cluster',
      status: 'ACTIVE',
      version: '1.36',
      instanceTypes: ['t3.medium'],
      scalingConfig: { minSize: 1, maxSize: 3, desiredSize: 2 },
      capacityType: 'ON_DEMAND',
      nodeRole: 'arn:aws:iam::000000000000:role/eks-node-role',
      subnets: ['subnet-1'],
      resources: { autoScalingGroups: [{ name: 'eks-ng-workers-abc' }] },
      health: { issues: [] },
    },
  },
};

const DESCRIBE_DEGRADED = {
  service: 'eks',
  operation: 'DescribeNodegroup',
  result: {
    nodegroup: {
      ...DESCRIBE_NODEGROUP.result.nodegroup,
      status: 'DEGRADED',
      health: {
        issues: [
          { code: 'NodeCreationFailure', message: 'nodes did not join' },
          { code: 'Ec2InstanceTypeMismatch', message: 'instance type is not available' },
        ],
      },
    },
  },
};

const DESCRIBE_INSTANCES = {
  service: 'ec2',
  operation: 'DescribeInstances',
  result: {
    Reservations: [
      {
        Instances: [
          {
            InstanceId: 'i-worker1',
            InstanceType: 't3.medium',
            State: { Name: 'running' },
            Tags: [
              { Key: 'Name', Value: 'ng-workers-node' },
              { Key: 'eks:nodegroup-name', Value: 'ng-workers' },
              { Key: 'eks:cluster-name', Value: 'localdeck-cluster' },
            ],
          },
        ],
      },
    ],
  },
};

function renderTab(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/eks/clusters/localdeck-cluster']}>
        <NodegroupsTab cluster={CLUSTER} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('EKS NodegroupsTab', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'eks/ListNodegroups': LIST_NODEGROUPS,
        'eks/DescribeNodegroup': DESCRIBE_NODEGROUP,
        'ec2/DescribeInstances': DESCRIBE_INSTANCES,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the node group with status, instance types and scaling', async () => {
    renderTab();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('ng-workers')).toBeDefined();
    expect(within(table).getByText('Active')).toBeDefined();
    expect(within(table).getByText('t3.medium')).toBeDefined();
    expect(within(table).getByText('1/3/2')).toBeDefined();
    expect(within(table).getByText('ON_DEMAND')).toBeDefined();
  });

  it('deep-links the emulated EC2 instance behind the node group', async () => {
    renderTab();

    const link = await screen.findByRole('link', { name: 'ng-workers-node' });
    expect(link.getAttribute('href')).toBe('/console/ec2/instances/i-worker1');
  });

  it('shows every health issue, not only the first', async () => {
    stubApiFetch({
      operations: {
        'eks/ListNodegroups': LIST_NODEGROUPS,
        'eks/DescribeNodegroup': DESCRIBE_DEGRADED,
        'ec2/DescribeInstances': DESCRIBE_INSTANCES,
      },
    });
    renderTab();

    expect(await screen.findByText(/nodes did not join/)).toBeDefined();
    expect(screen.getByText(/instance type is not available/)).toBeDefined();
  });

  it('keeps the unverified console actions visible but disabled with a reason', async () => {
    renderTab();

    const actions = await screen.findByRole('button', { name: 'Actions for ng-workers' });
    fireEvent.click(actions);
    expect(await screen.findByText('Change Kubernetes version')).toBeDefined();
    expect(screen.getByText(/not whitelisted in LocalDeck yet/)).toBeDefined();
  });

  it('fetches the emulated EC2 catalogue once per load and refreshes it explicitly', async () => {
    renderTab();

    await screen.findByRole('link', { name: 'ng-workers-node' });
    expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);

    // The explicit refresh re-fetches the node groups and the EC2 catalogue.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh node groups' }));
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(2);
    });
  });
});
