import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchedOperationCalls, jsonResponse, stubApiFetch } from '../../test/fixtures';
import {
  authorizeSecurityGroupIngress,
  createVolume,
  getImage,
  getInstance,
  instanceName,
  isTransitionalInstanceState,
  isVolumeAttached,
  listAllInstances,
  listImages,
  listInstanceVolumes,
  listInstances,
  listSecurityGroups,
  listVolumes,
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

  it('maps security group references and prefix lists, not only CIDRs', () => {
    const group = toEc2SecurityGroup({
      GroupId: 'sg-1',
      GroupName: 'web',
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          Description: 'application tier',
          PrefixListIds: [{ PrefixListId: 'pl-123' }],
          UserIdGroupPairs: [{ GroupId: 'sg-app', GroupName: 'app' }],
        },
      ],
    });

    expect(group?.inbound[0]).toMatchObject({
      protocol: 'tcp',
      description: 'application tier',
      prefixListIds: ['pl-123'],
      referencedGroups: ['sg-app'],
    });
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

  it('requires an exact instance id even when LocalStack ignores the filter', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: {
            Reservations: [
              {
                Instances: [
                  { InstanceId: 'i-other', InstanceType: 't3.micro', State: { Name: 'running' } },
                ],
              },
            ],
          },
        },
      },
    });

    await expect(getInstance('i-missing')).rejects.toMatchObject({
      apiError: { code: 'NOT_FOUND' },
    });
  });

  it('requires an exact image id even when LocalStack ignores the filter', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeImages': {
          service: 'ec2',
          operation: 'DescribeImages',
          result: { Images: [{ ImageId: 'ami-other', Name: 'unrelated' }] },
        },
      },
    });

    await expect(getImage('ami-missing')).rejects.toMatchObject({
      apiError: { code: 'NOT_FOUND' },
    });
  });

  it('sends gp3 throughput and IOPS but never throughput for other types', async () => {
    stubApiFetch({
      operations: {
        'ec2/CreateVolume': {
          service: 'ec2',
          operation: 'CreateVolume',
          result: { VolumeId: 'vol-1' },
        },
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: { Volumes: [{ VolumeId: 'vol-1', State: 'creating', VolumeType: 'gp3' }] },
        },
      },
    });

    await createVolume({
      availabilityZone: 'us-east-1a',
      sizeGiB: 20,
      volumeType: 'gp3',
      iops: 4000,
      throughput: 300,
      clientToken: 'token-1',
    });

    const gp3Input = lastDispatchedInput('CreateVolume');
    expect(gp3Input).toMatchObject({
      VolumeType: 'gp3',
      Iops: 4000,
      Throughput: 300,
      ClientToken: 'token-1',
    });

    await createVolume({
      availabilityZone: 'us-east-1a',
      sizeGiB: 20,
      volumeType: 'io2',
      iops: 4000,
      throughput: 300,
    });
    const io2Input = lastDispatchedInput('CreateVolume');
    expect(io2Input['Throughput']).toBeUndefined();
    expect(io2Input).toMatchObject({ VolumeType: 'io2', Iops: 4000 });
  });

  it('sends the RunInstances client token and per-device IOPS', async () => {
    await runInstances({
      imageId: 'ami-1',
      instanceType: 't3.micro',
      tags: [],
      clientToken: 'run-token',
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          sizeGiB: 20,
          volumeType: 'gp3',
          deleteOnTermination: true,
          iops: 4000,
        },
      ],
    });

    expect(lastDispatchedInput('RunInstances')).toMatchObject({
      ClientToken: 'run-token',
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/sda1',
          Ebs: { VolumeSize: 20, VolumeType: 'gp3', Iops: 4000 },
        },
      ],
    });
  });

  it('keeps every security-group source in the authorize payload', async () => {
    stubApiFetch({
      operations: {
        'ec2/AuthorizeSecurityGroupIngress': {
          service: 'ec2',
          operation: 'AuthorizeSecurityGroupIngress',
          result: {},
        },
      },
    });

    await authorizeSecurityGroupIngress({
      groupId: 'sg-1',
      rule: {
        protocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        description: 'tls from app',
        cidrIpv4: ['10.0.0.0/16'],
        referencedGroups: ['sg-app'],
        prefixListIds: ['pl-123'],
      },
    });

    expect(lastDispatchedInput('AuthorizeSecurityGroupIngress')).toMatchObject({
      GroupId: 'sg-1',
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          Description: 'tls from app',
          IpRanges: [{ CidrIp: '10.0.0.0/16' }],
          UserIdGroupPairs: [{ GroupId: 'sg-app' }],
          PrefixListIds: [{ PrefixListId: 'pl-123' }],
        },
      ],
    });
  });

  it('scopes the volume, subnet and image list requests server-side', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: { Volumes: [] },
        },
        'ec2/DescribeSecurityGroups': {
          service: 'ec2',
          operation: 'DescribeSecurityGroups',
          result: { SecurityGroups: [] },
        },
        'ec2/DescribeImages': {
          service: 'ec2',
          operation: 'DescribeImages',
          result: { Images: [] },
        },
      },
    });

    await listInstanceVolumes('i-1');
    expect(lastDispatchedInput('DescribeVolumes')).toMatchObject({
      Filters: [{ Name: 'attachment.instance-id', Values: ['i-1'] }],
    });

    await listVolumes({ filters: [{ Name: 'status', Values: ['available'] }] });
    expect(lastDispatchedInput('DescribeVolumes')).toMatchObject({
      Filters: [{ Name: 'status', Values: ['available'] }],
    });

    await listSecurityGroups({ filters: [{ Name: 'vpc-id', Values: ['vpc-1'] }] });
    expect(lastDispatchedInput('DescribeSecurityGroups')).toMatchObject({
      Filters: [{ Name: 'vpc-id', Values: ['vpc-1'] }],
    });

    await listImages({ owners: ['amazon'] });
    expect(lastDispatchedInput('DescribeImages')).toMatchObject({ Owners: ['amazon'] });
  });
});

describe('EC2 pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pages until NextToken disappears', async () => {
    let call = 0;
    const pages = [
      {
        Reservations: [
          {
            Instances: [
              { InstanceId: 'i-1', InstanceType: 't3.micro', State: { Name: 'running' } },
            ],
          },
        ],
        NextToken: 't1',
      },
      {
        Reservations: [
          {
            Instances: [
              { InstanceId: 'i-2', InstanceType: 't3.micro', State: { Name: 'running' } },
            ],
          },
        ],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        return jsonResponse({ service: 'ec2', operation: 'DescribeInstances', result: page });
      }),
    );

    const items = await listAllInstances();
    expect(items.map((instance) => instance.instanceId)).toEqual(['i-1', 'i-2']);
    expect(call).toBe(2);
  });

  it('stops instead of looping forever when the service repeats a token', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return jsonResponse({
          service: 'ec2',
          operation: 'DescribeInstances',
          result: {
            Reservations: [
              {
                Instances: [
                  { InstanceId: `i-${call}`, InstanceType: 't3.micro', State: { Name: 'running' } },
                ],
              },
            ],
            NextToken: 'stuck',
          },
        });
      }),
    );

    const items = await listAllInstances();
    expect(items.map((instance) => instance.instanceId)).toEqual(['i-1', 'i-2']);
    expect(call).toBe(2);
  });
});

/** Parsed input of the last dispatcher request for one operation. */
function lastDispatchedInput(operation: string): Record<string, unknown> {
  const calls = vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => String(input).includes(`/api/services/ec2/${operation}`));
  const call = calls[calls.length - 1];
  if (call === undefined) throw new Error(`${operation} was not dispatched`);
  const request = JSON.parse(String(call[1]?.body)) as { input: Record<string, unknown> };
  return request.input;
}
