// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { CreateSecurityGroupModal } from './CreateSecurityGroupModal';

function renderModal(): void {
  render(
    <CreateSecurityGroupModal
      vpcId="vpc-1"
      onDismiss={() => undefined}
      onCreated={() => undefined}
    />,
  );
}

describe('EC2 CreateSecurityGroupModal', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeVpcs': {
          service: 'ec2',
          operation: 'DescribeVpcs',
          result: { Vpcs: [{ VpcId: 'vpc-1', IsDefault: true }] },
        },
        'ec2/CreateSecurityGroup': {
          service: 'ec2',
          operation: 'CreateSecurityGroup',
          result: { GroupId: 'sg-1' },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('disables Create and blocks the submit while a tag row is invalid', async () => {
    renderModal();
    const create = await screen.findByRole('button', { name: 'Create security group' });
    await waitFor(() => {
      expect(create.hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'oops' } });

    expect(create.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/Tag keys cannot be empty or whitespace/).length).toBeGreaterThan(0);

    fireEvent.click(create);
    expect(dispatchedOperationCalls('ec2', 'CreateSecurityGroup')).toBe(0);

    fireEvent.change(screen.getByLabelText('Tag key 1'), { target: { value: 'env' } });
    expect(create.hasAttribute('disabled')).toBe(false);
  });
});
