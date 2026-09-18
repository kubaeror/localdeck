import { createServiceSpec } from '@localdeck/shared';

/**
 * EC2 capability metadata.
 *
 * `operations` must stay a subset of the registry whitelist in
 * `packages/shared/src/services.ts`; `createServiceSpec` throws at module load
 * otherwise, and the api rejects anything else with 400 before the SDK runs.
 *
 * Every operation here was exercised against the running LocalStack before it
 * was whitelisted (see `live-localstack-ec2.test.ts` and `verify:localstack`).
 * `DetachVolume` is deliberately absent: this LocalStack build answers it with
 * an internal error, so the volume pages render the action disabled with an
 * explanation instead of calling it.
 */
export const spec = createServiceSpec('ec2', {
  operations: [
    // Instances
    'DescribeInstances',
    'RunInstances',
    'StartInstances',
    'StopInstances',
    'RebootInstances',
    'TerminateInstances',
    // Images and instance types
    'DescribeImages',
    'DescribeInstanceTypes',
    // Key pairs
    'DescribeKeyPairs',
    'CreateKeyPair',
    'DeleteKeyPair',
    // Security groups
    'DescribeSecurityGroups',
    'CreateSecurityGroup',
    'AuthorizeSecurityGroupIngress',
    'RevokeSecurityGroupIngress',
    'DeleteSecurityGroup',
    // Volumes
    'DescribeVolumes',
    'CreateVolume',
    'AttachVolume',
    'DeleteVolume',
    // Tags (instances, volumes, security groups and key pairs share one API)
    'CreateTags',
    'DeleteTags',
    // Networking
    'DescribeVpcs',
    'DescribeSubnets',
    'DescribeAvailabilityZones',
  ],
  capabilities: { list: true, detail: true, create: true },
});

export const SERVICE_ID = spec.descriptor.id;
