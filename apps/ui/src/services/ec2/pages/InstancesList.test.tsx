// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { InstancesListPage } from './InstancesList';

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

function renderList(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/ec2/instances']}>
        <InstancesListPage descriptor={{ ...EC2_DESCRIPTOR }} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

const DESCRIBE_INSTANCES = {
  service: 'ec2',
  operation: 'DescribeInstances',
  result: {
    Reservations: [
      {
        Instances: [
          {
            InstanceId: 'i-alpha',
            InstanceType: 't3.micro',
            State: { Name: 'running' },
            Placement: { AvailabilityZone: 'us-east-1a' },
            LaunchTime: '2026-01-02T03:04:05.000Z',
            Tags: [{ Key: 'Name', Value: 'alpha' }],
          },
          {
            InstanceId: 'i-beta',
            InstanceType: 't3.small',
            State: { Name: 'stopped' },
            Placement: { AvailabilityZone: 'us-east-1b' },
            LaunchTime: '2026-01-03T04:05:06.000Z',
            Tags: [{ Key: 'Name', Value: 'beta' }],
          },
        ],
      },
    ],
  },
};

describe('EC2 InstancesListPage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeInstances': DESCRIBE_INSTANCES,
        'ec2/StartInstances': {
          service: 'ec2',
          operation: 'StartInstances',
          result: {
            StartingInstances: [{ InstanceId: 'i-beta', CurrentState: { Name: 'pending' } }],
          },
        },
        'ec2/TerminateInstances': {
          service: 'ec2',
          operation: 'TerminateInstances',
          result: {
            TerminatingInstances: [{ InstanceId: 'i-alpha', CurrentState: { Name: 'terminated' } }],
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders instances with name, id, coloured state, type, zone and launch time', async () => {
    renderList();

    expect(await screen.findByRole('heading', { level: 1, name: 'Instances' })).toBeDefined();
    const table = await screen.findByRole('table');
    for (const header of [
      'Name',
      'Instance ID',
      'Instance state',
      'Instance type',
      'Availability Zone',
      'Launch time',
    ]) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeDefined();
    }

    expect(within(table).getByText('alpha')).toBeDefined();
    expect(within(table).getByText('i-beta')).toBeDefined();
    expect(within(table).getByText('Running')).toBeDefined();
    expect(within(table).getByText('Stopped')).toBeDefined();
    expect(within(table).getByText('January 2, 2026, 3:04:05 AM (UTC)')).toBeDefined();
  });

  it('filters the list by name', async () => {
    renderList();
    await screen.findByText('alpha');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter instances' }), {
      target: { value: 'beta' },
    });

    expect(screen.getByText('beta')).toBeDefined();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('starts a stopped instance through the bulk action and its confirmation modal', async () => {
    renderList();
    await screen.findByText('alpha');

    const [betaCheckbox] = screen.getAllByLabelText('Select i-beta');
    if (betaCheckbox === undefined) throw new Error('the beta checkbox was not rendered');
    fireEvent.click(betaCheckbox);
    fireEvent.click(await screen.findByRole('button', { name: 'Instance actions' }));
    fireEvent.click(await screen.findByText('Start instance'));

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText(/Start instance/)).toBeDefined();
    fireEvent.click(within(modal).getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'StartInstances')).toBe(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gates termination behind the typed confirmation', async () => {
    renderList();
    await screen.findByText('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
    fireEvent.click(await screen.findByText('Terminate instance'));

    const modal = await screen.findByRole('dialog');
    expect(within(modal).getAllByText('Terminate instance').length).toBeGreaterThan(0);
    const submit = within(modal).getByRole('button', { name: 'Terminate instance' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm terminate of i-alpha'), {
      target: { value: 'i-alpha' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'TerminateInstances')).toBe(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing when a lifecycle action does not apply to the instance', async () => {
    renderList();
    await screen.findByText('alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
    // alpha is running, so "Start instance" is disabled and must not open a modal.
    fireEvent.click(await screen.findByText('Start instance'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('auto-refreshes every 10 seconds while an instance is pending or stopping', async () => {
    vi.useFakeTimers();
    try {
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
                      InstanceId: 'i-pending',
                      InstanceType: 't3.micro',
                      State: { Name: 'pending' },
                      Tags: [{ Key: 'Name', Value: 'pending-one' }],
                    },
                  ],
                },
              ],
            },
          },
        },
      });
      renderList();

      await vi.advanceTimersByTimeAsync(0);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(2);

      // Two ticks, one reload each — never more.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops refreshing once every instance reports a settled state', async () => {
    vi.useFakeTimers();
    try {
      renderList();

      await vi.advanceTimersByTimeAsync(0);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);

      // The stub serves running/stopped instances, so no timer is scheduled.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling after an action even when the refetch still looks settled', async () => {
    vi.useFakeTimers();
    try {
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
                      State: { Name: 'running' },
                      Tags: [{ Key: 'Name', Value: 'alpha' }],
                    },
                    {
                      InstanceId: 'i-beta',
                      InstanceType: 't3.small',
                      State: { Name: 'stopped' },
                      Tags: [{ Key: 'Name', Value: 'beta' }],
                    },
                  ],
                },
              ],
            },
          },
          'ec2/StopInstances': {
            service: 'ec2',
            operation: 'StopInstances',
            result: {
              StoppingInstances: [{ InstanceId: 'i-alpha', CurrentState: { Name: 'stopping' } }],
            },
          },
        },
      });
      renderList();
      await vi.advanceTimersByTimeAsync(0);
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(1);

      fireEvent.click(screen.getByRole('button', { name: 'Actions for alpha' }));
      fireEvent.click(screen.getByText('Stop instance'));
      const modal = screen.getByRole('dialog');
      fireEvent.click(within(modal).getByRole('button', { name: 'Stop' }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(dispatchedOperationCalls('ec2', 'StopInstances')).toBe(1);
      const afterAction = dispatchedOperationCalls('ec2', 'DescribeInstances');

      // The action opened a tracking window: the next tick refetches even
      // though the stub never reports a transitional state.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(afterAction + 1);

      // The window closes after 30 s; without an observed transitional state
      // polling stops again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40_000);
      });
      const afterWindow = dispatchedOperationCalls('ec2', 'DescribeInstances');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(dispatchedOperationCalls('ec2', 'DescribeInstances')).toBe(afterWindow);
    } finally {
      vi.useRealTimers();
    }
  });
});
