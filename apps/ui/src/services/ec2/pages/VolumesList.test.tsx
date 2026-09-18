// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { VolumesListPage } from './VolumesList';

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
      <MemoryRouter initialEntries={['/console/ec2/volumes']}>
        <VolumesListPage descriptor={{ ...EC2_DESCRIPTOR }} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('EC2 VolumesListPage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeVolumes': {
          service: 'ec2',
          operation: 'DescribeVolumes',
          result: {
            Volumes: [
              {
                VolumeId: 'vol-1',
                State: 'available',
                Size: 8,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1a',
                Tags: [{ Key: 'Name', Value: 'one' }],
              },
              {
                VolumeId: 'vol-2',
                State: 'error',
                Size: 8,
                VolumeType: 'gp3',
                AvailabilityZone: 'us-east-1a',
                Tags: [{ Key: 'Name', Value: 'two' }],
              },
            ],
          },
        },
        'ec2/DeleteVolume': {
          error: {
            code: 'DependencyViolation',
            message: 'The volume is still in use',
            statusCode: 400,
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders a failed volume as Error, not Available', async () => {
    renderList();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Error')).toBeDefined();
  });

  it('keeps the bulk delete modal open with a failure summary for retry', async () => {
    renderList();
    await screen.findByText('one');

    const [first] = screen.getAllByLabelText('Select vol-1');
    const [second] = screen.getAllByLabelText('Select vol-2');
    if (first === undefined || second === undefined) throw new Error('selection boxes missing');
    fireEvent.click(first);
    fireEvent.click(second);
    fireEvent.click(screen.getByRole('button', { name: 'Volume actions' }));
    fireEvent.click(await screen.findByText('Delete volumes'));

    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText(/Confirm deletion/), {
      target: { value: 'delete' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Delete volumes' }));

    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'DeleteVolume')).toBe(2);
    });
    // The modal stays open: both failures remain selected for a retry.
    expect(await screen.findByText(/2 of 2 volumes could not be deleted/)).toBeDefined();
    const retryModal = screen.getByRole('dialog');
    expect(within(retryModal).getByRole('button', { name: 'Delete volumes' })).toBeDefined();
  }, 15_000);
});
