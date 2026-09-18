// @vitest-environment node
/**
 * Live EKS module test against the *running* LocalDeck api and the external
 * LocalStack it is bound to.
 *
 * Read-only checks (supported versions, cluster list) run whenever
 * `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm --filter @localdeck/ui verify:console
 *
 * The full cluster lifecycle (create → ACTIVE → node group → kubeconfig →
 * delete) additionally needs `VITE_LIVEDECK_LIVE_EKS_CREATE=1`, because
 * LocalStack Pro starts a real k3d cluster for it and the run takes minutes.
 * When LocalStack's k3d infrastructure cannot start the cluster (for example
 * when `host.docker.internal` does not point at the Docker host), the test
 * asserts the FAILED terminal state LocalDeck renders and logs the limitation
 * instead of pretending the emulator worked.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getText } from '../../lib/apiClient';
import { listSubnets, listVpcs } from '../ec2/api';
import {
  createCluster,
  createNodegroup,
  deleteCluster,
  deleteNodegroup,
  getCluster,
  getNodegroup,
  kubeconfigPath,
  listClusterNames,
  listClusterVersions,
  listNodegroups,
  type EksCluster,
} from './api';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const CREATE_OPTED_IN = import.meta.env.VITE_LIVEDECK_LIVE_EKS_CREATE === '1';
const liveDescribe = describe.skipIf(API_BASE === undefined);

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

const stamp = Date.now().toString(36);
const clusterName = `localdeck-ui-live-${stamp}`;
const nodegroupName = `ng-${stamp}`;
const roleArn = 'arn:aws:iam::000000000000:role/localdeck-ui-live';

/** Polls DescribeCluster until the status is terminal or the timeout passes. */
async function waitForClusterStatus(
  name: string,
  wanted: readonly string[],
  timeoutMs: number,
): Promise<EksCluster> {
  const deadline = Date.now() + timeoutMs;
  let last: EksCluster | undefined;
  for (;;) {
    last = await getCluster(name);
    if (wanted.includes(last.status) || Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

liveDescribe('EKS module against the live api and LocalStack', () => {
  beforeAll(() => {
    installLiveFetch();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
  });

  it('reports the Kubernetes versions LocalStack supports', async () => {
    const versions = await listClusterVersions();
    expect(versions.length).toBeGreaterThan(0);
    const versionsOnly = versions.map((entry) => entry.version);
    expect(versionsOnly).toContain('1.36');
    expect(versions.filter((entry) => entry.defaultVersion)).toHaveLength(1);
  });

  it('lists clusters as plain names', async () => {
    const names = await listClusterNames();
    expect(Array.isArray(names)).toBe(true);
  });

  liveDescribe('cluster lifecycle', () => {
    const lifecycle = it.skipIf(!CREATE_OPTED_IN);
    let clusterCreated = false;
    let nodegroupCreated = false;

    afterAll(async () => {
      // Never leave a k3d cluster behind, even when an assertion failed.
      try {
        if (nodegroupCreated) {
          try {
            await deleteNodegroup(clusterName, nodegroupName);
          } catch {
            // The node group may already be gone with its cluster.
          }
        }
        if (clusterCreated) await deleteCluster(clusterName);
      } catch {
        // Cleanup failures are reported by the lifecycle itself.
      }
    });

    lifecycle(
      'creates a cluster, reaches a terminal status, and cleans up',
      async () => {
        // The wizard's networking step: subnets from the default VPC.
        const vpcs = await listVpcs();
        const firstVpc = vpcs[0];
        const subnets = firstVpc === undefined ? [] : await listSubnets({ vpcId: firstVpc.vpcId });
        const subnetIds = subnets.slice(0, 2).map((subnet) => subnet.subnetId);

        const created = await createCluster({
          name: clusterName,
          version: '1.36',
          roleArn,
          subnetIds,
          endpointPublicAccess: true,
          endpointPrivateAccess: false,
          publicAccessCidrs: ['0.0.0.0/0'],
          tags: [{ Key: 'localdeck:live', Value: stamp }],
        });
        clusterCreated = true;
        expect(created.name).toBe(clusterName);
        expect(['CREATING', 'ACTIVE']).toContain(created.status);

        const settled = await waitForClusterStatus(clusterName, ['ACTIVE', 'FAILED'], 12 * 60_000);
        expect(['ACTIVE', 'FAILED']).toContain(settled.status);

        if (settled.status === 'FAILED') {
          // LocalStack's k3d infrastructure failed to start the cluster. The
          // console renders this state with environment guidance; the emulator
          // is managed externally, so the test records it rather than trying
          // to repair LocalStack.
          console.warn(
            `[live-eks] LocalStack reported ${clusterName} as FAILED before ACTIVE; ` +
              'see the LocalStack EKS logs for the k3d error.',
          );
          await deleteCluster(clusterName);
          clusterCreated = false;
          return;
        }

        // Kubeconfig download through the dedicated api route.
        const kubeconfig = await getText(kubeconfigPath(clusterName));
        expect(kubeconfig.text).toContain('apiVersion: v1');
        expect(kubeconfig.text).toContain('kind: Config');
        expect(kubeconfig.text).toContain(`current-context:`);
        expect(kubeconfig.text).toContain('certificate-authority-data:');
        expect(kubeconfig.text).toContain('server:');
        expect(kubeconfig.text).toContain('get-token');
        expect(kubeconfig.fileName).toBe(`kubeconfig-${clusterName}.yaml`);

        // A managed node group the same way the wizard submits it.
        await createNodegroup({
          clusterName,
          nodegroupName,
          nodeRole: roleArn,
          subnetIds: subnetIds.length > 0 ? subnetIds : settled.vpcConfig.subnetIds.slice(0, 2),
          instanceTypes: ['t3.medium'],
          scaling: { minSize: 1, maxSize: 2, desiredSize: 1 },
          capacityType: 'ON_DEMAND',
        });
        nodegroupCreated = true;

        let nodegroupStatus = 'CREATING';
        const deadline = Date.now() + 10 * 60_000;
        while (!['ACTIVE', 'CREATE_FAILED', 'DEGRADED'].includes(nodegroupStatus)) {
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          nodegroupStatus = (await getNodegroup(clusterName, nodegroupName)).status;
        }
        expect(nodegroupStatus).toBe('ACTIVE');

        const listed = await listNodegroups(clusterName);
        expect(listed.items.map((entry) => entry.nodegroupName)).toContain(nodegroupName);

        await deleteNodegroup(clusterName, nodegroupName);
        nodegroupCreated = false;
        await deleteCluster(clusterName);
        clusterCreated = false;
      },
      20 * 60_000,
    );
  });
});
