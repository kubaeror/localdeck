// @vitest-environment jsdom
import type { ServiceDescriptor } from '@localdeck/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { LocalStackStatusProvider } from '../../../contexts/LocalStackStatusProvider';
import { stubApiFetch } from '../../../test/fixtures';
import { ClusterDetailPage } from './ClusterDetail';

const EKS_DESCRIPTOR: ServiceDescriptor = {
  id: 'eks',
  displayName: 'EKS',
  category: 'Containers',
  sdkPackage: '@aws-sdk/client-eks',
  iconKey: 'eks',
  operations: [],
  parityLevel: 'dedicated',
  summary: 'Managed Kubernetes clusters and node groups.',
};

const ACTIVE_CLUSTER = {
  service: 'eks',
  operation: 'DescribeCluster',
  result: {
    cluster: {
      name: 'localdeck-cluster',
      arn: 'arn:aws:eks:us-east-1:000000000000:cluster/localdeck-cluster',
      status: 'ACTIVE',
      version: '1.36',
      endpoint: 'https://localhost.localstack.cloud:4513',
      roleArn: 'arn:aws:iam::000000000000:role/eks-role',
      platformVersion: 'eks.7',
      createdAt: '2026-01-02T03:04:05.000Z',
      certificateAuthority: { data: 'Y2EtZGF0YQ==' },
      resourcesVpcConfig: {
        subnetIds: ['subnet-1', 'subnet-2'],
        securityGroupIds: [],
        vpcId: 'vpc-1',
        endpointPublicAccess: true,
        endpointPrivateAccess: false,
        publicAccessCidrs: ['0.0.0.0/0'],
      },
    },
  },
};

function renderDetail(): void {
  render(
    <LocalStackStatusProvider>
      <FlashbarProvider>
        <MemoryRouter initialEntries={['/console/eks/clusters/localdeck-cluster']}>
          <Routes>
            <Route
              path="/console/eks/clusters/:clusterName"
              element={<ClusterDetailPage descriptor={EKS_DESCRIPTOR} />}
            />
          </Routes>
        </MemoryRouter>
      </FlashbarProvider>
    </LocalStackStatusProvider>,
  );
}

describe('EKS ClusterDetailPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the Overview / Compute / Tags tabs with the live cluster values', async () => {
    stubApiFetch({
      operations: {
        'eks/DescribeCluster': ACTIVE_CLUSTER,
        'eks/ListNodegroups': {
          service: 'eks',
          operation: 'ListNodegroups',
          result: { nodegroups: [] },
        },
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: { Reservations: [] },
        },
      },
    });

    renderDetail();

    expect(
      await screen.findByRole('heading', { level: 1, name: /localdeck-cluster/ }),
    ).toBeDefined();
    // The status appears in the header and in the overview key-value pairs.
    expect((await screen.findAllByText('Active')).length).toBeGreaterThan(0);
    expect(await screen.findByText('https://localhost.localstack.cloud:4513')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Compute' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Tags' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Download kubeconfig' })).toBeDefined();
    expect(screen.getByText('Connect locally')).toBeDefined();
  });

  it('explains a FAILED cluster with LocalStack k3d guidance instead of a stack trace', async () => {
    stubApiFetch({
      operations: {
        'eks/DescribeCluster': {
          service: 'eks',
          operation: 'DescribeCluster',
          result: {
            cluster: {
              ...ACTIVE_CLUSTER.result.cluster,
              status: 'FAILED',
            },
          },
        },
        'eks/ListNodegroups': {
          service: 'eks',
          operation: 'ListNodegroups',
          result: { nodegroups: [] },
        },
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: { Reservations: [] },
        },
      },
    });

    renderDetail();

    expect(await screen.findByText('LocalStack could not start this cluster')).toBeDefined();
    expect(screen.getByText(/host.docker.internal:host-gateway/)).toBeDefined();
    expect((await screen.findAllByText('Failed')).length).toBeGreaterThan(0);
  });
});
