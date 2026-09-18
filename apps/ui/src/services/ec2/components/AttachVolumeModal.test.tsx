// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubApiFetch } from '../../../test/fixtures';
import { AttachVolumeModal } from './AttachVolumeModal';

const onAttached = vi.fn();
const onDismiss = vi.fn();

function renderModal(props: { volumeId?: string; instanceId?: string }): void {
  render(<AttachVolumeModal {...props} onDismiss={onDismiss} onAttached={onAttached} />);
}

/** The Cloudscape option with the given text (option content is aria-hidden). */
function optionMatching(fragment: string): HTMLElement {
  const option = screen
    .getAllByRole('option')
    .find((entry) => entry.textContent?.includes(fragment) === true);
  if (option === undefined) throw new Error(`the "${fragment}" option was not rendered`);
  return option;
}

describe('AttachVolumeModal', () => {
  beforeEach(() => {
    onAttached.mockReset();
    onDismiss.mockReset();
    stubApiFetch({
      operations: {
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: {
            Volumes: [
              {
                VolumeId: 'vol-a',
                State: 'available',
                Size: 8,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1a',
              },
              {
                VolumeId: 'vol-b',
                State: 'available',
                Size: 20,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1b',
              },
            ],
          },
        },
        'ec2/DescribeInstances': {
          service: 'ec2',
          operation: 'DescribeInstances',
          result: {
            Reservations: [
              {
                Instances: [
                  {
                    InstanceId: 'i-run',
                    InstanceType: 't3.micro',
                    State: { Name: 'running' },
                    Placement: { AvailabilityZone: 'us-east-1a' },
                    Tags: [{ Key: 'Name', Value: 'runner' }],
                  },
                  {
                    InstanceId: 'i-stop',
                    InstanceType: 't3.small',
                    State: { Name: 'stopped' },
                    Placement: { AvailabilityZone: 'us-east-1b' },
                    Tags: [{ Key: 'Name', Value: 'stopper' }],
                  },
                  {
                    InstanceId: 'i-term',
                    InstanceType: 't3.micro',
                    State: { Name: 'terminated' },
                    Placement: { AvailabilityZone: 'us-east-1a' },
                  },
                  {
                    InstanceId: 'i-pending',
                    InstanceType: 't3.micro',
                    State: { Name: 'pending' },
                    Placement: { AvailabilityZone: 'us-east-1a' },
                  },
                ],
              },
            ],
          },
        },
        'ec2/AttachVolume': {
          service: 'ec2',
          operation: 'AttachVolume',
          result: {},
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('offers only volumes in the selected instance Availability Zone', async () => {
    renderModal({ instanceId: 'i-run' });
    await screen.findByText('Choose a volume');

    fireEvent.mouseDown(screen.getByRole('button', { name: /Volume/ }));

    expect(optionMatching('vol-a')).toBeDefined();
    expect(
      screen.queryAllByRole('option').some((entry) => entry.textContent?.includes('vol-b')),
    ).toBe(false);
  });

  it('restricts the instance list to running/stopped instances in the volume zone', async () => {
    renderModal({ volumeId: 'vol-b' });
    await screen.findByText('Choose an instance');

    fireEvent.mouseDown(screen.getByRole('button', { name: /Instance/ }));

    // vol-b lives in us-east-1b: only the stopped instance there is offered;
    // the terminated and pending instances must never appear.
    expect(optionMatching('stopper')).toBeDefined();
    const optionTexts = screen.getAllByRole('option').map((entry) => entry.textContent ?? '');
    expect(optionTexts.some((text) => text.includes('runner'))).toBe(false);
    expect(optionTexts.some((text) => text.includes('i-term'))).toBe(false);
    expect(optionTexts.some((text) => text.includes('i-pending'))).toBe(false);
  });

  it('accepts both sd and xvd device prefixes and sends the chosen name', async () => {
    renderModal({ instanceId: 'i-run', volumeId: 'vol-a' });
    const attachButton = await screen.findByRole('button', { name: 'Attach volume' });
    await waitFor(() => {
      expect(attachButton.hasAttribute('disabled')).toBe(false);
    });

    const deviceInput = screen.getByLabelText('Device name');
    fireEvent.change(deviceInput, { target: { value: '/dev/sd1' } });
    expect(await screen.findByText(/Use a name like \/dev\/sdf or \/dev\/xvdh/)).toBeDefined();
    expect(attachButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(deviceInput, { target: { value: '/dev/xvdh' } });
    await waitFor(() => {
      expect(attachButton.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(attachButton);

    await waitFor(() => {
      expect(onAttached).toHaveBeenCalledTimes(1);
    });
    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) => String(input).includes('/ec2/AttachVolume'));
    const request = JSON.parse(String(call?.[1]?.body)) as { input: Record<string, unknown> };
    expect(request.input).toMatchObject({
      VolumeId: 'vol-a',
      InstanceId: 'i-run',
      Device: '/dev/xvdh',
    });
  });
});
