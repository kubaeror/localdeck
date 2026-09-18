// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { DashboardPage } from './Dashboard';

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

function renderDashboard(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/ec2']}>
        <DashboardPage descriptor={{ ...EC2_DESCRIPTOR }} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('EC2 DashboardPage', () => {
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
                  { InstanceId: 'i-1', InstanceType: 't3.micro', State: { Name: 'running' } },
                ],
              },
            ],
            // The dashboard must render "1+" instead of paging through the rest.
            NextToken: 'more',
          },
        },
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
        'ec2/DescribeKeyPairs': {
          service: 'ec2',
          operation: 'DescribeKeyPairs',
          result: {
            KeyPairs: [
              {
                KeyName: 'localdeck-key',
                KeyPairId: 'key-1',
                KeyType: 'rsa',
                KeyFingerprint: 'aa:bb:cc',
              },
            ],
          },
        },
        'ec2/DeleteKeyPair': { service: 'ec2', operation: 'DeleteKeyPair', result: {} },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders single-page counts as "100+" and lists the key pairs with a delete action', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { level: 1, name: /Dashboard/ })).toBeDefined();
    expect(await screen.findByText('1+')).toBeDefined();

    // The key-pair surface is the wizard's "existing key pair" source.
    expect(await screen.findByText('localdeck-key')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for localdeck-key' }));
    fireEvent.click(await screen.findByText('Delete key pair'));

    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText(/Confirm deletion/), {
      target: { value: 'localdeck-key' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Delete key pair' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'DeleteKeyPair')).toBe(1);
    });
  }, 15_000);
});
