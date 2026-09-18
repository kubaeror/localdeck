// @vitest-environment jsdom
/**
 * Live EKS console UI test against a *running* LocalDeck api and the external
 * LocalStack instance it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * Read-only coverage (the clusters list and the create wizard's live version
 * catalogue) always runs. The full lifecycle test additionally needs
 * `VITE_LIVEDECK_LIVE_EKS_CREATE=1`: it creates a k3d-backed cluster the same
 * way the wizard submits it, renders the real cluster page and waits for the
 * polling loop to report the terminal state. LocalStack starts a real k3d
 * cluster, so that run takes minutes — and on hosts where LocalStack's k3d
 * networking cannot start the cluster it asserts the FAILED state and the
 * console's environment guidance instead of pretending the cluster worked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { listSubnets, listVpcs } from '../ec2/api';
import {
  createCluster,
  deleteCluster,
  getCluster,
  listClusterNames,
  listClusterVersions,
} from './api';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const CREATE_OPTED_IN = import.meta.env.VITE_LIVEDECK_LIVE_EKS_CREATE === '1';
const liveDescribe = describe.skipIf(API_BASE === undefined);

const LIVE_TIMEOUT = { timeout: 30_000 };

/** Prefixes relative api paths with the live api base, like the dev proxy. */
function installLiveFetch(): void {
  const base = API_BASE ?? '';
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
    ),
  );
}

function renderApp(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const stamp = Date.now().toString(36);
const clusterName = `localdeck-ui-eks-${stamp}`;

liveDescribe('EKS console pages against the external LocalStack', () => {
  beforeAll(() => {
    installLiveFetch();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('lists the live clusters with the console columns', async () => {
    const names = await listClusterNames();
    renderApp('/console/eks');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clusters' })).toBeDefined();
    await screen.findByRole('table');
    for (const header of ['Name', 'Status', 'Kubernetes version', 'Created']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeDefined();
    }
    expect(screen.getAllByRole('button', { name: 'Create cluster' }).length).toBeGreaterThan(0);

    for (const name of names.slice(0, 3)) {
      expect(await screen.findByText(name)).toBeDefined();
    }
  }, 60_000);

  it('renders the create wizard with the live Kubernetes versions', async () => {
    const versions = await listClusterVersions();
    renderApp('/console/eks/create');

    expect(await screen.findByRole('heading', { level: 1, name: 'Create cluster' })).toBeDefined();
    // The wizard preselects the default version DescribeClusterVersions reports.
    const defaultVersion = versions.find((entry) => entry.defaultVersion)?.version;
    if (defaultVersion !== undefined) {
      expect((await screen.findAllByText(defaultVersion)).length).toBeGreaterThan(0);
    }
    // Step one asks for the name, version and role.
    expect(await screen.findByPlaceholderText('localdeck-cluster')).toBeDefined();
  }, 60_000);

  const lifecycle = it.skipIf(!CREATE_OPTED_IN);
  lifecycle(
    'creates a cluster, shows progress, and reports the terminal state in the UI',
    async () => {
      const vpcs = await listVpcs();
      const firstVpc = vpcs[0];
      const subnets = firstVpc === undefined ? [] : await listSubnets({ vpcId: firstVpc.vpcId });
      const subnetIds = subnets.slice(0, 2).map((subnet) => subnet.subnetId);

      await createCluster({
        name: clusterName,
        version: '1.36',
        roleArn: 'arn:aws:iam::000000000000:role/localdeck-ui-eks',
        subnetIds,
        endpointPublicAccess: true,
        endpointPrivateAccess: false,
        publicAccessCidrs: ['0.0.0.0/0'],
        tags: [{ Key: 'localdeck:live', Value: stamp }],
      });

      try {
        renderApp(`/console/eks/clusters/${clusterName}`);

        expect(
          await screen.findByRole('heading', { level: 1, name: clusterName }, LIVE_TIMEOUT),
        ).toBeDefined();
        // The page renders the lifecycle status (CREATING/ACTIVE on the happy
        // path, FAILED when LocalStack's k3d infra cannot start) and keeps
        // polling while the cluster settles.
        await waitFor(() => {
          const statuses = ['Creating', 'Active', 'Failed'].filter(
            (status) => screen.queryAllByText(status).length > 0,
          );
          expect(statuses.length).toBeGreaterThan(0);
        }, LIVE_TIMEOUT);

        // The page's own 5 s polling loop reports the terminal state; the UI
        // test just waits for it. LocalStack may take minutes to start k3d.
        await waitFor(
          () => {
            const active = screen.queryAllByText('Active');
            const failed = screen.queryAllByText('Failed');
            expect(active.length + failed.length).toBeGreaterThan(0);
          },
          { timeout: 12 * 60_000, interval: 5_000 },
        );

        const cluster = await getCluster(clusterName);
        if (cluster.status === 'ACTIVE') {
          // The kubeconfig download is enabled only for an ACTIVE cluster.
          const download = await screen.findByRole('button', { name: 'Download kubeconfig' });
          expect(download.hasAttribute('disabled')).toBe(false);
          expect(await screen.findByText('Connect locally')).toBeDefined();
          fireEvent.click(screen.getByRole('tab', { name: 'Compute' }));
          expect(await screen.findByRole('button', { name: 'Create node group' })).toBeDefined();
        } else {
          // LocalStack's k3d infrastructure could not start the cluster; the
          // console must explain the environment, never render a stack trace.
          expect(cluster.status).toBe('FAILED');
          expect(await screen.findByText('LocalStack could not start this cluster')).toBeDefined();
          const kubeconfig = await screen.findByRole('button', { name: 'Download kubeconfig' });
          expect(kubeconfig.hasAttribute('disabled')).toBe(true);
        }
      } finally {
        try {
          await deleteCluster(clusterName);
        } catch {
          // The cluster may already be gone.
        }
      }
    },
    20 * 60_000,
  );
});
