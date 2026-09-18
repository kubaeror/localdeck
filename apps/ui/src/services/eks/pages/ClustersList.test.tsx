// @vitest-environment jsdom
import type { HealthResponse, ServiceDescriptor } from '@localdeck/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { EmulatorStatusProvider } from '../../../contexts/EmulatorStatusProvider';
import { TEST_HEALTH, stubApiFetch } from '../../../test/fixtures';
import { ClustersListPage } from './ClustersList';

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

/** The health document the emulator sends when EKS is enabled. */
const HEALTH_WITH_EKS: HealthResponse = {
  ...TEST_HEALTH,
  emulator: {
    ...TEST_HEALTH.emulator,
    services: { ...TEST_HEALTH.emulator.services, eks: 'enabled' },
  },
};

const DESCRIBE_CLUSTER = {
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
      createdAt: '2026-01-02T03:04:05.000Z',
      resourcesVpcConfig: { subnetIds: ['subnet-1'], endpointPublicAccess: true },
    },
  },
};

function renderList(): void {
  render(
    <EmulatorStatusProvider>
      <FlashbarProvider>
        <MemoryRouter initialEntries={['/console/eks']}>
          <ClustersListPage descriptor={EKS_DESCRIPTOR} />
        </MemoryRouter>
      </FlashbarProvider>
    </EmulatorStatusProvider>,
  );
}

describe('EKS ClustersListPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the cluster list with status, version and creation time', async () => {
    stubApiFetch({
      health: HEALTH_WITH_EKS,
      operations: {
        'eks/ListClusters': {
          service: 'eks',
          operation: 'ListClusters',
          result: { clusters: ['localdeck-cluster'] },
        },
        'eks/DescribeCluster': DESCRIBE_CLUSTER,
      },
    });

    renderList();

    expect(await screen.findByRole('heading', { level: 1, name: 'Clusters' })).toBeDefined();
    expect(await screen.findByText('localdeck-cluster')).toBeDefined();
    expect(await screen.findByText('Active')).toBeDefined();
    expect(await screen.findByText('1.36')).toBeDefined();
    expect(await screen.findByText('January 2, 2026, 3:04:05 AM (UTC)')).toBeDefined();
  });

  it('renders the "not enabled" empty state instead of calling EKS when health omits it', async () => {
    stubApiFetch({
      operations: {
        'eks/ListClusters': { service: 'eks', operation: 'ListClusters', result: { clusters: [] } },
      },
    });

    renderList();

    expect(await screen.findByText('EKS is not enabled in this LocalStack instance')).toBeDefined();
    expect(screen.getByText(/does not report the/)).toBeDefined();
    // No EKS operation ever reached the dispatcher.
    await waitFor(() => {
      const calls = vi
        .mocked(globalThis.fetch)
        .mock.calls.filter(([input]) => String(input).includes('/api/services/eks/'));
      expect(calls).toHaveLength(0);
    });
  });

  it('names the active provider in the "not enabled" empty state', async () => {
    const providerLabel = 'MiniStack';
    stubApiFetch({
      health: {
        ...TEST_HEALTH,
        provider: { ...TEST_HEALTH.provider, providerLabel },
        emulator: { ...TEST_HEALTH.emulator, providerLabel },
      },
    });

    renderList();

    expect(
      await screen.findByText(`EKS is not enabled in this ${providerLabel} instance`),
    ).toBeDefined();
    expect(screen.getByText(new RegExp(`${providerLabel} at`))).toBeDefined();
  });

  it('keeps polling after the list deletes a cluster (DELETING is transitional)', async () => {
    stubApiFetch({
      health: HEALTH_WITH_EKS,
      operations: {
        'eks/ListClusters': {
          service: 'eks',
          operation: 'ListClusters',
          result: { clusters: ['going-away'] },
        },
        'eks/DescribeCluster': {
          service: 'eks',
          operation: 'DescribeCluster',
          result: {
            cluster: {
              name: 'going-away',
              arn: 'arn:aws:eks:us-east-1:000000000000:cluster/going-away',
              status: 'DELETING',
              version: '1.36',
              roleArn: '',
              resourcesVpcConfig: { endpointPublicAccess: true, endpointPrivateAccess: false },
            },
          },
        },
      },
    });

    renderList();

    expect(await screen.findByText('Deleting')).toBeDefined();
    expect(await screen.findByText(/Refreshing automatically every 10 seconds/)).toBeDefined();
  });

  it('shows the auto-refresh hint while a cluster is being created', async () => {
    stubApiFetch({
      health: HEALTH_WITH_EKS,
      operations: {
        'eks/ListClusters': {
          service: 'eks',
          operation: 'ListClusters',
          result: { clusters: ['creating'] },
        },
        'eks/DescribeCluster': {
          service: 'eks',
          operation: 'DescribeCluster',
          result: {
            cluster: {
              name: 'creating',
              arn: 'arn:aws:eks:us-east-1:000000000000:cluster/creating',
              status: 'CREATING',
              version: '1.36',
              roleArn: '',
              resourcesVpcConfig: { endpointPublicAccess: true, endpointPrivateAccess: false },
            },
          },
        },
      },
    });

    renderList();

    expect(await screen.findByText('Creating')).toBeDefined();
    expect(await screen.findByText(/Refreshing automatically every 10 seconds/)).toBeDefined();
  });
});
