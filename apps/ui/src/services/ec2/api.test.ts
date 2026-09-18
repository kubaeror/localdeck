import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchedOperationCalls, stubApiFetch } from '../../test/fixtures';
import {
  instanceName,
  isTransitionalInstanceState,
  isVolumeAttached,
  listInstances,
  runInstances,
  startInstances,
  toEc2Image,
  toEc2Instance,
  toEc2InstanceType,
  toEc2SecurityGroup,
  toEc2Subnet,
  toEc2Volume,
  toEc2Vpc,
} from './api';

describe('EC2 api mappers', () => {
  it('maps a raw instance, including its Name tag and block devices', () => {
    const instance = toEc2Instance({
      InstanceId: 'i-0123456789abcdef0',
      InstanceType: 't3.micro',
      State: { Code: 16, Name: 'running' },
      Placement: { AvailabilityZone: 'us-east-1a' },
      LaunchTime: '2026-01-02T03:04:05.000Z',
      ImageId: 'ami-123',
      KeyName: 'localdeck-key',
      PublicIpAddress: '54.1.2.3',
      PrivateIpAddress: '172.31.0.5',
      VpcId: 'vpc-1',
      SubnetId: 'subnet-1',
      SecurityGroups: [{ GroupId: 'sg-1', GroupName: 'default' }],
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/sda1',
          Ebs: { VolumeId: 'vol-1', DeleteOnTermination: true },
        },
      ],
      Tags: [
        { Key: 'env', Value: 'test' },
        { Key: 'Name', Value: 'web-server' },
      ],
    });

    expect(instance).toMatchObject({
      instanceId: 'i-0123456789abcdef0',
      name: 'web-server',
      state: 'running',
      instanceType: 't3.micro',
      availabilityZone: 'us-east-1a',
      keyName: 'localdeck-key',
      publicIpAddress: '54.1.2.3',
      securityGroups: [{ id: 'sg-1', name: 'default' }],
      blockDevices: [{ deviceName: '/dev/sda1', volumeId: 'vol-1', deleteOnTermination: true }],
    });
    expect(instanceName(instance!)).toBe('web-server');
  });

  it('falls back to an unknown state instead of inventing one', () => {
    const instance = toEc2Instance({ InstanceId: 'i-1', State: { Name: 'hibernating' } });
    expect(instance?.state).toBe('unknown');
  });

  it('returns null when the identifier is missing', () => {
    expect(toEc2Instance({ InstanceType: 't3.micro' })).toBeNull();
    expect(toEc2Image({ Name: 'no-id' })).toBeNull();
    expect(toEc2Volume({ State: 'available' })).toBeNull();
    expect(toEc2SecurityGroup({ GroupName: 'no-id' })).toBeNull();
  });

  it('maps images, keying the owner alias and platform the console shows', () => {
    const image = toEc2Image({
      ImageId: 'ami-0abcdef',
      Name: 'al2023-ami',
      Description: 'Amazon Linux 2023',
      State: 'available',
      ImageOwnerAlias: 'amazon',
      Architecture: 'x86_64',
      PlatformDetails: 'Linux/UNIX',
      RootDeviceName: '/dev/xvda',
      CreationDate: '2026-02-03T04:05:06.000Z',
      Public: true,
    });

    expect(image).toMatchObject({
      imageId: 'ami-0abcdef',
      name: 'al2023-ami',
      ownerAlias: 'amazon',
      architecture: 'x86_64',
      platformDetails: 'Linux/UNIX',
      isPublic: true,
    });
  });

  it('maps volumes with their attachments', () => {
    const volume = toEc2Volume({
      VolumeId: 'vol-1',
      State: 'in-use',
      Size: 8,
      VolumeType: 'gp3',
      AvailabilityZone: 'us-east-1a',
      Encrypted: false,
      CreateTime: '2026-01-01T00:00:00.000Z',
      Attachments: [
        {
          InstanceId: 'i-1',
          Device: '/dev/sdf',
          State: 'attached',
          DeleteOnTermination: false,
        },
      ],
      Tags: [{ Key: 'Name', Value: 'data' }],
    });

    expect(volume).toMatchObject({
      volumeId: 'vol-1',
      name: 'data',
      state: 'in-use',
      sizeGiB: 8,
      encrypted: false,
      attachments: [{ instanceId: 'i-1', device: '/dev/sdf', deleteOnTermination: false }],
    });
    expect(isVolumeAttached(volume!)).toBe(true);
    expect(isVolumeAttached({ attachments: [], state: 'available' })).toBe(false);
  });

  it('reads both SDK spellings of a security group description', () => {
    const current = toEc2SecurityGroup({
      GroupId: 'sg-1',
      GroupName: 'web',
      Description: 'current spelling',
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 80,
          ToPort: 80,
          IpRanges: [{ CidrIp: '0.0.0.0/0' }],
        },
      ],
      IpPermissionsEgress: [],
    });
    const legacy = toEc2SecurityGroup({
      GroupId: 'sg-2',
      GroupName: 'legacy',
      GroupDescription: 'legacy spelling',
    });

    expect(current?.description).toBe('current spelling');
    expect(current?.inbound[0]).toMatchObject({
      protocol: 'tcp',
      fromPort: 80,
      ipv4Ranges: ['0.0.0.0/0'],
    });
    expect(legacy?.description).toBe('legacy spelling');
  });

  it('maps instance types, VPCs and subnets', () => {
    const type = toEc2InstanceType({
      InstanceType: 'm5.large',
      VCpuInfo: { DefaultVCpus: 2 },
      MemoryInfo: { SizeInMiB: 8192 },
      ProcessorInfo: { SupportedArchitectures: ['x86_64'] },
      NetworkInfo: { NetworkPerformance: 'Up to 10 Gigabit' },
      FreeTierEligible: false,
    });
    expect(type).toMatchObject({
      instanceType: 'm5.large',
      vCpus: 2,
      memoryMiB: 8192,
      architecture: 'x86_64',
      instanceStorage: 'EBS only',
    });

    expect(toEc2Vpc({ VpcId: 'vpc-1', IsDefault: true, CidrBlock: '172.31.0.0/16' })).toMatchObject(
      {
        vpcId: 'vpc-1',
        isDefault: true,
      },
    );
    expect(
      toEc2Subnet({
        SubnetId: 'subnet-1',
        VpcId: 'vpc-1',
        AvailabilityZone: 'us-east-1a',
        DefaultForAz: true,
        MapPublicIpOnLaunch: true,
      }),
    ).toMatchObject({
      subnetId: 'subnet-1',
      vpcId: 'vpc-1',
      availabilityZone: 'us-east-1a',
      isDefaultForAz: true,
    });
  });

  it('treats pending, stopping and shutting-down as transitional', () => {
    expect(isTransitionalInstanceState('pending')).toBe(true);
    expect(isTransitionalInstanceState('stopping')).toBe(true);
    expect(isTransitionalInstanceState('shutting-down')).toBe(true);
    expect(isTransitionalInstanceState('running')).toBe(false);
    expect(isTransitionalInstanceState('stopped')).toBe(false);
    expect(isTransitionalInstanceState('terminated')).toBe(false);
  });
});

describe('EC2 api operations', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-1',
                    InstanceType: 't3.micro',
                    State: { Name: 'running' },
                    Tags: [{ Key: 'Name', Value: 'alpha' }],
                  },
                  { InstanceId: 'i-2', InstanceType: 't3.small', State: { Name: 'stopped' } },
                ],
              },
            ],
          },
        },
        'ec2/StartInstances': {
          service: 'ec2',
          operation: 'StartInstances',
          result: {
            StartingInstances: [
              {
                InstanceId: 'i-2',
                PreviousState: { Name: 'stopped' },
                CurrentState: { Name: 'pending' },
              },
            ],
          },
        },
        'ec2/RunInstances': {
          service: 'ec2',
          operation: 'RunInstances',
          result: {
            Instances: [
              {
                InstanceId: 'i-3',
                InstanceType: 't3.micro',
                State: { Name: 'pending' },
                Tags: [{ Key: 'Name', Value: 'gamma' }],
              },
            ],
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flattens reservations into one page of instances', async () => {
    const page = await listInstances();
    expect(page.items.map((instance) => instance.instanceId)).toEqual(['i-1', 'i-2']);
    expect(page.items[0]?.name).toBe('alpha');
    expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);
  });

  it('never sends MaxResults together with explicit instance IDs', async () => {
    // LocalStack answers InvalidParameterCombination for that pair, and the
    // detail page depends on the id-filtered call.
    await listInstances({ instanceIds: ['i-1'] });

    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).includes('DescribeInstances'));
    const request = JSON.parse(String(call?.[1]?.body)) as {
      input: Record<string, unknown>;
    };
    expect(request.input['InstanceIds']).toEqual(['i-1']);
    expect(request.input['MaxResults']).toBeUndefined();
  });

  it('maps start responses into state changes', async () => {
    const changes = await startInstances(['i-2']);
    expect(changes).toEqual([
      { instanceId: 'i-2', previousState: 'stopped', currentState: 'pending' },
    ]);
  });

  it('returns the launched instance from RunInstances', async () => {
    const instance = await runInstances({
      imageId: 'ami-1',
      instanceType: 't3.micro',
      tags: [{ Key: 'Name', Value: 'gamma' }],
      securityGroupIds: ['sg-1'],
      blockDevices: [
        { deviceName: '/dev/sda1', sizeGiB: 20, volumeType: 'gp3', deleteOnTermination: true },
      ],
    });
    expect(instance.instanceId).toBe('i-3');
    expect(instance.state).toBe('pending');
    expect(dispatchedOperationCalls('ec2', 'RunInstances')).toBe(1);
  });
});
