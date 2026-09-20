// @vitest-environment jsdom
import type { ServiceDescriptor } from '@localdeck/shared';
import Flashbar from '@cloudscape-design/components/flashbar';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { EmulatorStatusProvider } from '../../../contexts/EmulatorStatusProvider';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { jsonResponse, stubApiFetch } from '../../../test/fixtures';
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

/** Renders the app-wide flashbar so the page tests can assert its messages. */
function FlashbarProbe(): ReactElement {
  const { items } = useFlashbar();
  return <Flashbar items={[...items]} />;
}

function renderDetail(): void {
  render(
    <EmulatorStatusProvider>
      <FlashbarProvider>
        <MemoryRouter initialEntries={['/console/eks/clusters/localdeck-cluster']}>
          <Routes>
            <Route
              path="/console/eks/clusters/:clusterName"
              element={<ClusterDetailPage descriptor={EKS_DESCRIPTOR} />}
            />
          </Routes>
          <FlashbarProbe />
        </MemoryRouter>
      </FlashbarProvider>
    </EmulatorStatusProvider>,
  );
}

interface StubReply {
  status: number;
  body: unknown;
}

/** Operation envelopes other than DescribeCluster, which the sequence stub owns. */
const OTHER_OPERATIONS = {
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
};

/**
 * `stubApiFetch` plus a per-call DescribeCluster sequence: the callback gets the
 * cluster name and the 1-based call number, so a test can fail exactly one poll.
 */
function stubDescribeCluster(handler: (name: string, call: number) => StubReply): {
  describeCalls: () => number;
} {
  stubApiFetch({ operations: OTHER_OPERATIONS });
  const base = globalThis.fetch;
  let calls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/services/eks/DescribeCluster')) {
      calls += 1;
      const body =
        init?.body === undefined
          ? {}
          : (JSON.parse(String(init.body)) as { input?: { name?: string } });
      const reply = handler(body.input?.name ?? '', calls);
      return jsonResponse(reply.body, reply.status);
    }
    return base(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { describeCalls: () => calls };
}

/** A DescribeCluster answer for one lifecycle status. */
function clusterResult(status: string): StubReply {
  return {
    status: 200,
    body: {
      service: 'eks',
      operation: 'DescribeCluster',
      result: {
        cluster: { ...ACTIVE_CLUSTER.result.cluster, status },
      },
    },
  };
}

function SwitchToSecondCluster(): ReactElement {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        void navigate('/console/eks/clusters/second-cluster');
      }}
    >
      Open second cluster
    </button>
  );
}

function renderDetailWithSwitch(): void {
  render(
    <EmulatorStatusProvider>
      <FlashbarProvider>
        <MemoryRouter initialEntries={['/console/eks/clusters/first-cluster']}>
          <SwitchToSecondCluster />
          <Routes>
            <Route
              path="/console/eks/clusters/:clusterName"
              element={<ClusterDetailPage descriptor={EKS_DESCRIPTOR} />}
            />
          </Routes>
          <FlashbarProbe />
        </MemoryRouter>
      </FlashbarProvider>
    </EmulatorStatusProvider>,
  );
}

describe('EKS ClusterDetailPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it('keeps the last good cluster when a silent poll fails, and keeps polling to ACTIVE', async () => {
    vi.useFakeTimers();
    const { describeCalls } = stubDescribeCluster((_name, call) => {
      if (call === 2) {
        return {
          status: 500,
          body: {
            error: {
              code: 'ServerException',
              message: 'DescribeCluster exploded',
              statusCode: 500,
            },
          },
        };
      }
      return clusterResult(call >= 3 ? 'ACTIVE' : 'CREATING');
    });

    renderDetail();

    // Initial load: CREATING, so the page schedules its 5 second poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(describeCalls()).toBe(1);
    expect(screen.getAllByText('Creating').length).toBeGreaterThan(0);

    // The first poll fails: the last good cluster must stay, so the page keeps
    // polling instead of dropping into the error state during k3d creation.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(describeCalls()).toBe(2);
    expect(screen.getAllByText('Creating').length).toBeGreaterThan(0);

    // The next poll succeeds and the transition is announced.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(describeCalls()).toBe(3);
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cluster localdeck-cluster is active').length).toBeGreaterThan(0);
  });

  it('resets the status tracker when the route moves to another cluster', async () => {
    stubDescribeCluster((name) => clusterResult(name === 'first-cluster' ? 'CREATING' : 'ACTIVE'));

    renderDetailWithSwitch();

    expect((await screen.findAllByText('Creating')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open second cluster' }));

    expect((await screen.findAllByText('Active')).length).toBeGreaterThan(0);
    // The previous cluster's CREATING status must not be treated as the new
    // cluster's previous status (which would announce a transition that never
    // happened for this cluster).
    expect(screen.queryByText('Cluster second-cluster is active')).toBeNull();
  });
});
