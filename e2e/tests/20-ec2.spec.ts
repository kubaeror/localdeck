import { expect, test } from '@playwright/test';
import {
  E2E_RESOURCE_PREFIX,
  E2E_TAG_KEY,
  callServiceOperation,
  fetchHealth,
  isEmulated,
  trackResource,
  uniqueName,
} from './helpers';

/**
 * EC2 launch/terminate smoke through the dynamic dispatcher — the same calls
 * the console's launch wizard makes (DescribeImages, DescribeInstanceTypes,
 * RunInstances) and the terminate action the instance list uses. The instance
 * is tagged for the global teardown sweep and terminated here even when an
 * assertion fails.
 */
test.describe('ec2 instance lifecycle', () => {
  test.describe.configure({ retries: 0 });

  test('launches an instance and terminates it again', async ({ request }) => {
    const health = await fetchHealth(request);
    test.skip(!isEmulated(health, 'ec2'), 'This LocalStack does not report EC2');

    const name = uniqueName(`${E2E_RESOURCE_PREFIX}-instance`);

    const images = await callServiceOperation<{ Images?: { ImageId?: string }[] }>(
      request,
      'ec2',
      'DescribeImages',
      {},
    );
    const imageId = images.Images?.[0]?.ImageId;
    if (imageId === undefined) {
      throw new Error('DescribeImages returned no launchable image');
    }

    const types = await callServiceOperation<{ InstanceTypes?: { InstanceType?: string }[] }>(
      request,
      'ec2',
      'DescribeInstanceTypes',
      {},
    );
    const instanceType = types.InstanceTypes?.[0]?.InstanceType ?? 't3.micro';

    const launched = await callServiceOperation<{ Instances?: { InstanceId?: string }[] }>(
      request,
      'ec2',
      'RunInstances',
      {
        ImageId: imageId,
        InstanceType: instanceType,
        MinCount: 1,
        MaxCount: 1,
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: name },
              { Key: E2E_TAG_KEY, Value: 'true' },
            ],
          },
        ],
      },
    );
    const instanceId = launched.Instances?.[0]?.InstanceId;
    if (instanceId === undefined) {
      throw new Error('RunInstances returned no instance id');
    }
    trackResource('ec2-instance', instanceId);

    try {
      await expect
        .poll(
          async () => {
            const described = await callServiceOperation<{
              Reservations?: { Instances?: { State?: { Name?: string } }[] }[];
            }>(request, 'ec2', 'DescribeInstances', { InstanceIds: [instanceId] });
            return described.Reservations?.[0]?.Instances?.[0]?.State?.Name;
          },
          { message: 'the instance never reached running', timeout: 60_000 },
        )
        .toBe('running');

      const terminated = await callServiceOperation<{
        TerminatingInstances?: { InstanceId?: string }[];
      }>(request, 'ec2', 'TerminateInstances', { InstanceIds: [instanceId] });
      expect(terminated.TerminatingInstances?.[0]?.InstanceId).toBe(instanceId);
    } finally {
      // Idempotent safety net: the global teardown would otherwise pick the
      // instance up, but terminating it now keeps the emulator tidy.
      try {
        await callServiceOperation(request, 'ec2', 'TerminateInstances', {
          InstanceIds: [instanceId],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[e2e] could not terminate ${instanceId} in the cleanup path: ${message}`);
      }
    }
  });
});
