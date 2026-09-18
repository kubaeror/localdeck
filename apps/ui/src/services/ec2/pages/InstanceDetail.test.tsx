// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { stubApiFetch } from '../../../test/fixtures';
import { InstanceDetailPage } from './InstanceDetail';

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

function renderDetail(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/ec2/instances/i-alpha']}>
        <Routes>
          <Route
            path="/console/ec2/instances/:instanceId"
            element={<InstanceDetailPage descriptor={{ ...EC2_DESCRIPTOR }} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('EC2 InstanceDetailPage', () => {
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
                    InstanceId: 'i-alpha',
                    InstanceType: 't3.micro',
                    State: { Name: 'pending' },
                    Placement: { AvailabilityZone: 'us-east-1a' },
                    LaunchTime: '2026-01-02T03:04:05.000Z',
                    PublicIpAddress: '54.1.2.3',
                    PrivateIpAddress: '172.31.0.5',
                    VpcId: 'vpc-1',
                    SubnetId: 'subnet-1',
                    RootDeviceName: '/dev/sda1',
                    RootDeviceType: 'ebs',
                    Tags: [{ Key: 'Name', Value: 'alpha' }],
                    SecurityGroups: [{ GroupId: 'sg-1', GroupName: 'default' }],
                  },
                ],
              },
            ],
          },
        },
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: {
            Volumes: [
              {
                VolumeId: 'vol-1',
                State: 'in-use',
                Size: 8,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1a',
                Attachments: [{ InstanceId: 'i-alpha', Device: '/dev/sda1', State: 'attached' }],
                Tags: [{ Key: 'Name', Value: 'alpha-root' }],
              },
            ],
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the instance details, the state and the persistent Emulated badge', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: /alpha/ })).toBeDefined();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Emulated').length).toBeGreaterThan(0);

    expect(screen.getByText('54.1.2.3')).toBeDefined();
    expect(screen.getByText('172.31.0.5')).toBeDefined();
    expect(screen.getByText('vpc-1')).toBeDefined();

    // The badge lives in the header, so it survives a tab switch.
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(await screen.findByText('Emulated')).toBeDefined();
  });

  it('renders the four console tabs and the storage tab contents', async () => {
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: /alpha/ });

    for (const tab of ['Details', 'Security', 'Storage', 'Tags']) {
      expect(screen.getByRole('tab', { name: tab })).toBeDefined();
    }

    fireEvent.click(screen.getByRole('tab', { name: 'Storage' }));
    expect(await screen.findByText('alpha-root')).toBeDefined();
    expect(screen.getByText('Root device')).toBeDefined();
    expect(
      screen.getByText('Detaching volumes is not supported by this LocalStack build'),
    ).toBeDefined();
  });

  it('explains the missing instance instead of rendering broken tabs', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: { Reservations: [] },
        },
      },
    });
    renderDetail();

    expect(await screen.findByText(/returned no instance for "i-alpha"/)).toBeDefined();
  });
});
