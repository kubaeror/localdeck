// @vitest-environment node
/**
 * Live EC2 module client test against the *running* LocalDeck api and the
 * external LocalStack it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * The test drives the module's own `api.ts` (the same calls the console makes)
 * through the acceptance flow: describe the catalogue → launch a tagged
 * instance → running → stop → start → reboot → attach a tagged data volume →
 * security group round-trip → terminate → release and delete the volume. It
 * only ever touches the resources it creates, and cleans them up in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  attachVolume,
  authorizeSecurityGroupIngress,
  createSecurityGroup,
  createTags,
  createVolume,
  deleteSecurityGroup,
  deleteVolume,
  getSecurityGroup,
  instanceName,
  listAllImages,
  listAllInstances,
  listAllInstanceTypes,
  listAllVolumes,
  listSecurityGroups,
  listSubnets,
  listVpcs,
  rebootInstances,
  revokeSecurityGroupIngress,
  runInstances,
  startInstances,
  stopInstances,
  terminateInstances,
  type Ec2InstanceState,
} from './api';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
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
const instanceNameTag = `localdeck-ui-live-${stamp}`;
const dataVolumeName = `${instanceNameTag}-data`;
const groupName = `localdeck-ui-live-sg-${stamp}`;

/** Polls DescribeInstances until the state is one of `wanted`. */
async function waitForInstanceState(
  instanceId: string,
  wanted: readonly Ec2InstanceState[],
  timeoutMs = 30_000,
): Promise<Ec2InstanceState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const instances = await listAllInstances();
    const state =
      instances.find((instance) => instance.instanceId === instanceId)?.state ?? 'unknown';
    if (wanted.includes(state) || Date.now() >= deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

liveDescribe('EC2 module against the live api and LocalStack', () => {
  let instanceId: string | undefined;
  let dataVolumeId: string | undefined;
  let securityGroupId: string | undefined;

  beforeAll(() => {
    installLiveFetch();
  });

  afterAll(async () => {
    // Best-effort cleanup, even when an assertion failed earlier.
    try {
      if (instanceId !== undefined) {
        const instances = await listAllInstances();
        const state = instances.find((instance) => instance.instanceId === instanceId)?.state;
        if (state !== 'terminated') await terminateInstances([instanceId]);
      }
    } catch {
      // Ignore: the instance may already be gone.
    }
    try {
      if (dataVolumeId !== undefined) {
        // Give a terminated instance a moment to release the attachment.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            await deleteVolume(dataVolumeId);
            break;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    } catch {
      // Ignore: the volume may already be gone.
    }
    try {
      if (securityGroupId !== undefined) await deleteSecurityGroup(securityGroupId);
    } catch {
      // Ignore: the group may already be gone.
    }
    vi.unstubAllGlobals();
  });

  it('runs the console acceptance flow end to end', async () => {
    // 1. The catalogue the wizard reads.
    const images = await listAllImages();
    expect(images.length).toBeGreaterThan(0);
    const image = images.find((entry) => entry.state === 'available') ?? images[0];
    if (image === undefined) throw new Error('LocalStack returned no image');

    const types = await listAllInstanceTypes();
    expect(types.some((type) => type.instanceType === 't3.micro')).toBe(true);

    const vpcs = await listVpcs();
    expect(vpcs.length).toBeGreaterThan(0);
    const subnets = await listSubnets({ vpcId: vpcs[0]?.vpcId });
    expect(subnets.length).toBeGreaterThan(0);
    const groups = (await listSecurityGroups()).items;
    expect(groups.length).toBeGreaterThan(0);

    // 2. Launch with the wizard's payload shape.
    const launched = await runInstances({
      imageId: image.imageId,
      instanceType: 't3.micro',
      tags: [
        { Key: 'Name', Value: instanceNameTag },
        { Key: 'localdeck:live', Value: stamp },
      ],
      subnetId: subnets[0]?.subnetId ?? '',
      securityGroupIds: groups[0] === undefined ? [] : [groups[0].groupId],
      blockDevices: [
        { deviceName: '/dev/sda1', sizeGiB: 20, volumeType: 'gp3', deleteOnTermination: true },
      ],
    });
    instanceId = launched.instanceId;
    expect(launched.imageId).toBe(image.imageId);
    expect(launched.tags.some((tag) => tag.Key === 'Name')).toBe(true);

    // 3. The lifecycle transition the console renders: running, then stop and
    //    start again, then reboot.
    expect(await waitForInstanceState(launched.instanceId, ['running'])).toBe('running');

    const stopping = await stopInstances([launched.instanceId]);
    expect(['stopping', 'stopped']).toContain(stopping[0]?.currentState);
    expect(await waitForInstanceState(launched.instanceId, ['stopped'])).toBe('stopped');

    const starting = await startInstances([launched.instanceId]);
    expect(['pending', 'running']).toContain(starting[0]?.currentState);
    expect(await waitForInstanceState(launched.instanceId, ['running'])).toBe('running');

    await rebootInstances([launched.instanceId]);
    expect(await waitForInstanceState(launched.instanceId, ['running'])).toBe('running');

    // 4. A tagged data volume, attached to the running instance.
    const created = await createVolume({
      availabilityZone: launched.availabilityZone ?? 'us-east-1a',
      sizeGiB: 5,
      volumeType: 'gp3',
      tags: [{ Key: 'Name', Value: dataVolumeName }],
    });
    dataVolumeId = created.volumeId;
    await createTags([created.volumeId], [{ Key: 'env', Value: 'live-test' }]);
    await attachVolume({
      volumeId: created.volumeId,
      instanceId: launched.instanceId,
      device: '/dev/sdf',
    });

    const volumes = await listAllVolumes();
    const attached = volumes.find((volume) => volume.volumeId === created.volumeId);
    expect(attached?.state).toBe('in-use');
    expect(attached?.attachments[0]?.instanceId).toBe(launched.instanceId);
    expect(attached?.name).toBe(dataVolumeName);

    // 5. Security group round-trip.
    const createdGroup = await createSecurityGroup({
      groupName,
      description: 'LocalDeck live test group',
      vpcId: vpcs[0]?.vpcId ?? '',
    });
    securityGroupId = createdGroup.groupId;
    expect(createdGroup.groupName).toBe(groupName);

    await authorizeSecurityGroupIngress({
      groupId: createdGroup.groupId,
      rule: { protocol: 'tcp', fromPort: 8080, toPort: 8080, cidrIpv4: ['0.0.0.0/0'] },
    });
    const withRule = await getSecurityGroup(createdGroup.groupId);
    expect(withRule.inbound[0]?.fromPort).toBe(8080);

    await revokeSecurityGroupIngress({
      groupId: createdGroup.groupId,
      rule: { protocol: 'tcp', fromPort: 8080, toPort: 8080, cidrIpv4: ['0.0.0.0/0'] },
    });
    const withoutRule = await getSecurityGroup(createdGroup.groupId);
    expect(withoutRule.inbound).toHaveLength(0);

    await deleteSecurityGroup(createdGroup.groupId);
    securityGroupId = undefined;

    // 6. Terminate: the instance ends up terminated and the attached volume is
    //    released back to available so it can be deleted.
    const terminating = await terminateInstances([launched.instanceId]);
    expect(['shutting-down', 'terminated']).toContain(terminating[0]?.currentState);
    expect(await waitForInstanceState(launched.instanceId, ['terminated'])).toBe('terminated');

    let released = false;
    for (let attempt = 0; attempt < 40 && !released; attempt += 1) {
      const current = await listAllVolumes();
      released = current.some(
        (volume) => volume.volumeId === created.volumeId && volume.state === 'available',
      );
      if (!released) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(released).toBe(true);

    await deleteVolume(created.volumeId);
    dataVolumeId = undefined;
    const after = await listAllVolumes();
    expect(after.some((volume) => volume.volumeId === created.volumeId)).toBe(false);

    // 7. The terminated instance is still listed (EC2 keeps the record), which
    //    is what the console shows after a termination.
    const instances = await listAllInstances();
    const terminated = instances.find((instance) => instance.instanceId === launched.instanceId);
    expect(terminated?.state).toBe('terminated');
    expect(instanceName(terminated ?? { instanceId: '' })).toBe(instanceNameTag);

    // The generous timeout covers the instance lifecycle polling.
  }, 120_000);
});
