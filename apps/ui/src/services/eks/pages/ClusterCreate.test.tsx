// @vitest-environment jsdom
import type { ServiceDescriptor } from '@localdeck/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { stubApiFetch } from '../../../test/fixtures';
import { ClusterCreatePage } from './ClusterCreate';

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

function renderCreate(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/eks/create']}>
        <ClusterCreatePage descriptor={EKS_DESCRIPTOR} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('EKS ClusterCreatePage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the wizard with the live Kubernetes versions and IAM roles', async () => {
    stubApiFetch({
      operations: {
        'eks/DescribeClusterVersions': {
          service: 'eks',
          operation: 'DescribeClusterVersions',
          result: {
            clusterVersions: [
              {
                clusterVersion: '1.36',
                defaultVersion: true,
                status: 'STANDARD_SUPPORT',
                defaultPlatformVersion: 'eks.7',
                kubernetesPatchVersion: '1.36.2',
              },
              { clusterVersion: '1.35', defaultVersion: false, status: 'STANDARD_SUPPORT' },
            ],
          },
        },
        'iam/ListRoles': {
          service: 'iam',
          operation: 'ListRoles',
          result: {
            Roles: [{ RoleName: 'eks-role', Arn: 'arn:aws:iam::000000000000:role/eks-role' }],
          },
        },
        'ec2/DescribeVpcs': {
          service: 'ec2',
          operation: 'DescribeVpcs',
          result: { Vpcs: [{ VpcId: 'vpc-1', CidrBlock: '172.31.0.0/16', IsDefault: true }] },
        },
        'ec2/DescribeSubnets': {
          service: 'ec2',
          operation: 'DescribeSubnets',
          result: {
            Subnets: [
              { SubnetId: 'subnet-1', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1a' },
              { SubnetId: 'subnet-2', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1b' },
            ],
          },
        },
        'ec2/DescribeSecurityGroups': {
          service: 'ec2',
          operation: 'DescribeSecurityGroups',
          result: { SecurityGroups: [] },
        },
      },
    });

    renderCreate();

    expect(await screen.findByRole('heading', { level: 1, name: 'Create cluster' })).toBeDefined();
    expect(screen.getAllByText('Configure cluster').length).toBeGreaterThan(0);
    // The default version LocalStack reported is preselected (wizard field and
    // summary rail both show it).
    await waitFor(() => {
      expect(screen.getAllByText('1.36').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Cluster summary')).toBeDefined();
  });
});
