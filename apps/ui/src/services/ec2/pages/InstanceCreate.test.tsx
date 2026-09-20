// @vitest-environment jsdom
import Flashbar from '@cloudscape-design/components/flashbar';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { dispatchedOperationCalls, jsonResponse, stubApiFetch } from '../../../test/fixtures';
import { InstanceCreatePage } from './InstanceCreate';

const EC2_DESCRIPTOR = {
  id: 'ec2',
  displayName: 'EC2',
  category: 'Compute',
  sdkPackage: '@aws-sdk/client-ec2',
  iconKey: 'ec2',
  operations: [],
  parityLevel: 'dedicated',
  summary: 'Virtual machines, security groups, VPCs, subnets and AMIs.',
} as const;

/**
 * The AppShell renders the flashbar in production; the test renders it next to
 * the page so notifications assertions have something to find.
 */
function FlashbarSink(): ReactElement {
  const { items } = useFlashbar();
  return <Flashbar items={[...items]} />;
}

function renderCreate(): void {
  render(
    <FlashbarProvider>
      <FlashbarSink />
      <MemoryRouter initialEntries={['/console/ec2/instances/launch']}>
        <Routes>
          <Route
            path="/console/ec2/instances/launch"
            element={<InstanceCreatePage descriptor={{ ...EC2_DESCRIPTOR }} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

function stubWizard(): void {
  stubApiFetch({
    operations: {
      ...WIZARD_OPERATIONS,
      'ec2/RunInstances': {
        error: {
          code: 'InvalidParameterValue',
          message: 'LocalStack rejected it',
          statusCode: 400,
        },
      },
    },
  });
}

const WIZARD_OPERATIONS: Readonly<Record<string, unknown>> = {
  'ec2/DescribeImages': {
    service: 'ec2',
    operation: 'DescribeImages',
    result: {
      Images: [
        {
          ImageId: 'ami-x86',
          Name: 'al2023-ami',
          State: 'available',
          Architecture: 'x86_64',
          RootDeviceName: '/dev/sda1',
          PlatformDetails: 'Linux/UNIX',
          ImageOwnerAlias: 'amazon',
        },
      ],
    },
  },
  'ec2/DescribeInstanceTypes': {
    service: 'ec2',
    operation: 'DescribeInstanceTypes',
    result: {
      InstanceTypes: [
        {
          InstanceType: 't3.micro',
          VCpuInfo: { DefaultVCpus: 2 },
          MemoryInfo: { SizeInMiB: 1024 },
          ProcessorInfo: { SupportedArchitectures: ['x86_64'] },
        },
        {
          InstanceType: 'm5.large',
          VCpuInfo: { DefaultVCpus: 2 },
          MemoryInfo: { SizeInMiB: 8192 },
          ProcessorInfo: { SupportedArchitectures: ['x86_64'] },
        },
      ],
    },
  },
  'ec2/DescribeKeyPairs': {
    service: 'ec2',
    operation: 'DescribeKeyPairs',
    result: { KeyPairs: [] },
  },
  'ec2/DescribeVpcs': {
    service: 'ec2',
    operation: 'DescribeVpcs',
    result: { Vpcs: [{ VpcId: 'vpc-1', IsDefault: true, CidrBlock: '172.31.0.0/16' }] },
  },
  'ec2/DescribeSubnets': {
    service: 'ec2',
    operation: 'DescribeSubnets',
    result: {
      Subnets: [
        {
          SubnetId: 'subnet-1',
          VpcId: 'vpc-1',
          AvailabilityZone: 'us-east-1a',
          DefaultForAz: true,
        },
      ],
    },
  },
  'ec2/DescribeSecurityGroups': {
    service: 'ec2',
    operation: 'DescribeSecurityGroups',
    result: {
      SecurityGroups: [{ GroupId: 'sg-1', GroupName: 'default', Description: 'default group' }],
    },
  },
  'ec2/CreateKeyPair': {
    service: 'ec2',
    operation: 'CreateKeyPair',
    result: {
      KeyName: 'localdeck-key',
      KeyPairId: 'key-1',
      KeyFingerprint: 'aa:bb',
      KeyMaterial: [
        '-----BEGIN',
        'RSA PRIVATE KEY-----',
        'secret',
        '-----END',
        'RSA PRIVATE KEY-----',
      ].join('\n'),
    },
  },
  'ec2/DeleteKeyPair': { service: 'ec2', operation: 'DeleteKeyPair', result: {} },
};

const LAUNCHED_INSTANCE = {
  InstanceId: 'i-new',
  InstanceType: 't3.micro',
  State: { Name: 'pending' },
  RootDeviceName: '/dev/sda1',
  BlockDeviceMappings: [
    { DeviceName: '/dev/sda1', Ebs: { VolumeId: 'vol-root', DeleteOnTermination: true } },
    { DeviceName: '/dev/sdf', Ebs: { VolumeId: 'vol-data' } },
    { DeviceName: '/dev/sdg', Ebs: { VolumeId: 'vol-fallback' } },
  ],
  Tags: [{ Key: 'Name', Value: 'web' }],
};

/** The wizard catalogue plus a successful launch and volume tagging. */
function stubSuccessfulLaunch(): void {
  stubApiFetch({
    operations: {
      ...WIZARD_OPERATIONS,
      'ec2/RunInstances': {
        service: 'ec2',
        operation: 'RunInstances',
        result: { Instances: [LAUNCHED_INSTANCE] },
      },
      'ec2/CreateTags': { service: 'ec2', operation: 'CreateTags', result: {} },
    },
  });
}

/** Walks the wizard to the review step with a new key pair. */
async function walkToReview(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Launch instance' });

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    expect(document.body.textContent).toContain('al2023-ami');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  // m5.large only appears in the instance-type table, so it is a real signal
  // that the catalogue (not just the summary rail) has loaded.
  await screen.findByText('m5.large');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  fireEvent.click(screen.getByLabelText(/Create a new key pair/));
  fireEvent.change(screen.getByLabelText('New key pair name'), {
    target: { value: 'localdeck-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  await waitFor(() => {
    expect(document.body.textContent).toContain('subnet-1');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Launch summary');
}

/** Walks the wizard to the storage step with a name and the default picks. */
async function walkToStorage(): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Launch instance' });
  fireEvent.change(screen.getByPlaceholderText('web-server'), { target: { value: 'web' } });

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => {
    expect(document.body.textContent).toContain('al2023-ami');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  await screen.findByText('m5.large');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  await waitFor(() => {
    expect(document.body.textContent).toContain('subnet-1');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { level: 2, name: 'Configure storage' });
}

/** Parsed input of the last dispatcher request for one operation. */
function dispatchedInput(operation: string): Record<string, unknown> {
  const calls = vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => String(input).includes(`/api/services/ec2/${operation}`));
  const call = calls[calls.length - 1];
  if (call === undefined) throw new Error(`${operation} was not dispatched`);
  const request = JSON.parse(String(call[1]?.body)) as { input: Record<string, unknown> };
  return request.input;
}

/** Parsed inputs of every CreateTags dispatcher request, in call order. */
function createTagsInputs(): Record<string, unknown>[] {
  return vi
    .mocked(globalThis.fetch)
    .mock.calls.filter(([input]) => String(input).includes('/api/services/ec2/CreateTags'))
    .map((call) => JSON.parse(String(call[1]?.body)) as { input: Record<string, unknown> })
    .map((request) => request.input);
}

describe('EC2 InstanceCreatePage key-pair recovery', () => {
  beforeEach(() => {
    stubWizard();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the created private key after a failed launch, reuses the pair, and can delete it', async () => {
    renderCreate();
    await walkToReview();

    fireEvent.click(screen.getByRole('button', { name: 'Launch instance' }));

    expect(await screen.findByText('Launch failed — save your private key')).toBeDefined();
    expect(dispatchedOperationCalls('ec2', 'CreateKeyPair')).toBe(1);
    expect(dispatchedOperationCalls('ec2', 'RunInstances')).toBe(1);

    const material = screen.getByLabelText('Private key material') as HTMLTextAreaElement;
    expect(material.value).toContain('RSA PRIVATE KEY');
    expect(screen.getByRole('button', { name: 'Download key pair' })).toBeDefined();

    // Retrying reuses the pair instead of failing with a duplicate name.
    fireEvent.click(screen.getByRole('button', { name: 'Back to the wizard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch instance' }));
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'RunInstances')).toBe(2);
    });
    expect(dispatchedOperationCalls('ec2', 'CreateKeyPair')).toBe(1);

    // Deleting the pair goes through DeleteKeyPair and clears the recovery UI.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete key pair' }));
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'DeleteKeyPair')).toBe(1);
    });
    await waitFor(() => {
      expect(screen.queryByText('Launch failed — save your private key')).toBeNull();
    });
    expect(dispatchedOperationCalls('ec2', 'DeleteKeyPair')).toBe(1);
  }, 20_000);

  it('only offers instance types compatible with the selected AMI architecture', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeImages': {
          service: 'ec2',
          operation: 'DescribeImages',
          result: {
            Images: [
              {
                ImageId: 'ami-arm',
                Name: 'al2023-arm',
                State: 'available',
                Architecture: 'arm64',
                RootDeviceName: '/dev/sda1',
              },
            ],
          },
        },
        'ec2/DescribeInstanceTypes': {
          service: 'ec2',
          operation: 'DescribeInstanceTypes',
          result: {
            InstanceTypes: [
              {
                InstanceType: 't4g.small',
                VCpuInfo: { DefaultVCpus: 2 },
                ProcessorInfo: { SupportedArchitectures: ['arm64'] },
              },
              {
                InstanceType: 'm5.large',
                VCpuInfo: { DefaultVCpus: 2 },
                ProcessorInfo: { SupportedArchitectures: ['x86_64'] },
              },
            ],
          },
        },
        'ec2/DescribeKeyPairs': {
          service: 'ec2',
          operation: 'DescribeKeyPairs',
          result: { KeyPairs: [] },
        },
        'ec2/DescribeVpcs': {
          service: 'ec2',
          operation: 'DescribeVpcs',
          result: { Vpcs: [{ VpcId: 'vpc-1', IsDefault: true }] },
        },
        'ec2/DescribeSubnets': {
          service: 'ec2',
          operation: 'DescribeSubnets',
          result: { Subnets: [{ SubnetId: 'subnet-1', VpcId: 'vpc-1', DefaultForAz: true }] },
        },
        'ec2/DescribeSecurityGroups': {
          service: 'ec2',
          operation: 'DescribeSecurityGroups',
          result: { SecurityGroups: [] },
        },
      },
    });
    renderCreate();
    await screen.findByRole('heading', { level: 1, name: 'Launch instance' });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('al2023-arm');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Only the arm64 type is listed; the x86_64 type is filtered out.
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('t4g.small')).toBeDefined();
    });
    const typeTable = screen.getByRole('table');
    expect(within(typeTable).queryByText('m5.large')).toBeNull();
    expect(screen.getAllByText(/Showing instance types that support/).length).toBeGreaterThan(0);

    // The summary rail carries the effective (compatible) type, not the stale
    // default that would never be launched.
    expect(screen.queryByText('t3.micro')).toBeNull();
    expect(screen.getAllByText('t4g.small').length).toBeGreaterThan(1);
  }, 20_000);
});

describe('EC2 InstanceCreatePage storage and volume tags', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('names each launched volume with CreateTags after RunInstances', async () => {
    stubSuccessfulLaunch();
    renderCreate();
    await walkToStorage();

    // /dev/sdf gets a user-provided name; /dev/sdg is left to the fallback.
    fireEvent.click(screen.getByRole('button', { name: 'Add new volume' }));
    fireEvent.change(await screen.findByLabelText('Name of /dev/sdf'), {
      target: { value: 'data' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add new volume' }));

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Launch summary');
    fireEvent.click(screen.getByRole('button', { name: 'Launch instance' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'RunInstances')).toBe(1);
    });

    // RunInstances carries only instance tags: no volume TagSpecification can
    // apply the root Name to every volume.
    expect(dispatchedInput('RunInstances')['TagSpecifications']).toEqual([
      { ResourceType: 'instance', Tags: [{ Key: 'Name', Value: 'web' }] },
    ]);

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'CreateTags')).toBe(3);
    });
    expect(createTagsInputs()).toEqual([
      { Resources: ['vol-root'], Tags: [{ Key: 'Name', Value: 'web-root' }] },
      { Resources: ['vol-data'], Tags: [{ Key: 'Name', Value: 'data' }] },
      { Resources: ['vol-fallback'], Tags: [{ Key: 'Name', Value: 'web-/dev/sdg' }] },
    ]);
  }, 20_000);

  it('reports a partial volume-tagging failure without failing the launch', async () => {
    stubSuccessfulLaunch();
    // Only the data volume rejects the tag; the root volume still succeeds.
    const baseImplementation = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/api/services/ec2/CreateTags')) {
        const request = JSON.parse(String(init?.body)) as { input: { Resources?: string[] } };
        if ((request.input.Resources ?? []).includes('vol-data')) {
          return jsonResponse(
            {
              error: {
                code: 'InvalidVolume.NotFound',
                statusCode: 400,
                message: 'The volume does not exist',
              },
            },
            400,
          );
        }
        return jsonResponse({ service: 'ec2', operation: 'CreateTags', result: {} });
      }
      if (baseImplementation === undefined) throw new Error('missing base fetch stub');
      return baseImplementation(input, init);
    });

    renderCreate();
    await walkToStorage();
    fireEvent.click(screen.getByRole('button', { name: 'Add new volume' }));

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Launch summary');
    fireEvent.click(screen.getByRole('button', { name: 'Launch instance' }));

    // The launch modal still appears: tagging is best-effort.
    expect(await screen.findByRole('button', { name: 'View instance' })).toBeDefined();
    expect(await screen.findByText(/some volume names were not applied/)).toBeDefined();
    expect(screen.getByText(/could not be tagged: The volume does not exist/)).toBeDefined();
    expect(dispatchedOperationCalls('ec2', 'CreateTags')).toBe(2);
  }, 20_000);

  it('blocks the name step while a tag row is invalid', async () => {
    stubWizard();
    renderCreate();
    await screen.findByRole('heading', { level: 1, name: 'Launch instance' });

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The step validation surfaces the message and does not advance the wizard.
    expect(
      (await screen.findAllByText(/Tag keys cannot be empty or whitespace/)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('heading', { level: 2, name: /Application and OS Images/ }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText('Tag key 1'), { target: { value: 'env' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('al2023-ami');
    });
  }, 20_000);

  it('offers only SSD volume types for the root volume', async () => {
    stubWizard();
    renderCreate();
    await walkToStorage();

    fireEvent.mouseDown(screen.getByRole('button', { name: /Root volume type/ }));
    const optionTexts = screen.getAllByRole('option').map((option) => option.textContent ?? '');
    for (const valid of ['gp3', 'gp2', 'io1', 'io2']) {
      expect(optionTexts.some((text) => text.includes(valid))).toBe(true);
    }
    for (const invalid of ['st1', 'sc1', 'standard']) {
      expect(optionTexts.some((text) => text.includes(invalid))).toBe(false);
    }
  }, 20_000);
});
