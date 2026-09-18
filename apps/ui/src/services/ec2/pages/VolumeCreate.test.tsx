// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { VolumeCreatePage } from './VolumeCreate';

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
      <MemoryRouter initialEntries={['/console/ec2/volumes/create']}>
        <Routes>
          <Route
            path="/console/ec2/volumes/create"
            element={<VolumeCreatePage descriptor={{ ...EC2_DESCRIPTOR }} />}
          />
          <Route path="/console/ec2/volumes/:volumeId" element={<div>Volume detail stub</div>} />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

/** The Cloudscape option with the given text (option content is aria-hidden). */
function optionMatching(fragment: string): HTMLElement {
  const option = screen
    .getAllByRole('option')
    .find((entry) => entry.textContent?.includes(fragment) === true);
  if (option === undefined) throw new Error(`the "${fragment}" option was not rendered`);
  return option;
}

/** Cloudscape dropdown items select on the full pointer sequence. */
function selectOption(fragment: string): void {
  const option = optionMatching(fragment);
  fireEvent.mouseDown(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

/** Parsed dispatcher request body for one operation. */
function dispatchedInput(operation: string): Record<string, unknown> {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([input]) => String(input).includes(`/api/services/ec2/${operation}`));
  if (call === undefined) throw new Error(`${operation} was not dispatched`);
  const request = JSON.parse(String(call[1]?.body)) as { input: Record<string, unknown> };
  return request.input;
}

describe('EC2 VolumeCreatePage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeAvailabilityZones': {
          service: 'ec2',
          operation: 'DescribeAvailabilityZones',
          result: {
            AvailabilityZones: [{ ZoneName: 'us-east-1a', State: 'available' }],
          },
        },
        'ec2/CreateVolume': {
          service: 'ec2',
          operation: 'CreateVolume',
          result: { VolumeId: 'vol-new' },
        },
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: {
            Volumes: [
              {
                VolumeId: 'vol-new',
                State: 'creating',
                Size: 8,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1a',
                Iops: 4000,
                Throughput: 250,
                Tags: [{ Key: 'Name', Value: 'new-volume' }],
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

  it('sends the gp3 throughput and custom IOPS it collected, with a client token', async () => {
    renderCreate();
    expect(await screen.findByRole('heading', { level: 1, name: 'Create volume' })).toBeDefined();
    await waitFor(() => {
      expect(document.body.textContent).toContain('us-east-1a');
    });

    fireEvent.change(screen.getByLabelText('Volume size'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Provisioned IOPS'), { target: { value: '4000' } });
    fireEvent.change(screen.getByLabelText('Throughput'), { target: { value: '250' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    // The review step reflects the values that will be sent.
    expect(await screen.findByText('250 MiB/s')).toBeDefined();
    expect(screen.getByText('4000')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Create volume' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'CreateVolume')).toBe(1);
    });
    expect(await screen.findByText('Volume detail stub')).toBeDefined();

    const input = dispatchedInput('CreateVolume');
    expect(input).toMatchObject({
      AvailabilityZone: 'us-east-1a',
      Size: 20,
      VolumeType: 'gp3',
      Iops: 4000,
      Throughput: 250,
    });
    expect(typeof input['ClientToken']).toBe('string');
    expect((input['ClientToken'] as string).length).toBeGreaterThan(0);
  }, 15_000);

  it('enforces the st1 minimum size before leaving the details step', async () => {
    renderCreate();
    await screen.findByRole('heading', { level: 1, name: 'Create volume' });
    await waitFor(() => {
      expect(document.body.textContent).toContain('us-east-1a');
    });

    fireEvent.mouseDown(screen.getByRole('button', { name: /Volume type/ }));
    selectOption('st1');

    fireEvent.change(screen.getByLabelText('Volume size'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // The wizard stays on the details step and reports the type-aware error.
    expect(
      (await screen.findAllByText(/st1 volumes must be between 125 and 16384 GiB/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText('Volume size')).toBeDefined();
    expect(dispatchedOperationCalls('ec2', 'CreateVolume')).toBe(0);

    fireEvent.change(screen.getByLabelText('Volume size'), { target: { value: '125' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tags' })).toBeDefined();
  }, 15_000);
});
