// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
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

function renderCreate(): void {
  render(
    <FlashbarProvider>
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
  }, 20_000);
});
