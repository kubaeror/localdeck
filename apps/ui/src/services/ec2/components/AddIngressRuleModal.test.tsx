// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubApiFetch } from '../../../test/fixtures';
import { AddIngressRuleModal } from './AddIngressRuleModal';

const onAdded = vi.fn();
const onDismiss = vi.fn();

function renderModal(): void {
  render(
    <AddIngressRuleModal
      groupId="sg-1"
      groupName="web"
      vpcId="vpc-1"
      onDismiss={onDismiss}
      onAdded={onAdded}
    />,
  );
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

describe('AddIngressRuleModal', () => {
  beforeEach(() => {
    onAdded.mockReset();
    onDismiss.mockReset();
    stubApiFetch({
      operations: {
        'ec2/DescribeSecurityGroups': {
          service: 'ec2',
          operation: 'DescribeSecurityGroups',
          result: {
            SecurityGroups: [
              {
                GroupId: 'sg-2',
                GroupName: 'database',
                Description: 'database clients',
                VpcId: 'vpc-1',
              },
            ],
          },
        },
        'ec2/AuthorizeSecurityGroupIngress': {
          service: 'ec2',
          operation: 'AuthorizeSecurityGroupIngress',
          result: {},
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('defaults to a custom CIDR and blocks Add until the CIDR is valid', async () => {
    renderModal();

    // Not "Anywhere": the source defaults to Custom and starts empty.
    expect(await screen.findByLabelText('CIDR block')).toBeDefined();
    const addButton = screen.getByRole('button', { name: 'Add rule' });
    expect(addButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('CIDR block'), {
      target: { value: '999.999.999.999/99' },
    });
    expect(await screen.findByText(/Use IPv4 CIDR notation/)).toBeDefined();
    expect(addButton.hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('This source is the entire internet')).toBeNull();

    fireEvent.change(screen.getByLabelText('CIDR block'), { target: { value: '10.0.0.0/8' } });
    await waitFor(() => {
      expect(addButton.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    expect(dispatchedInput('AuthorizeSecurityGroupIngress')).toMatchObject({
      GroupId: 'sg-1',
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 80,
          ToPort: 80,
          IpRanges: [{ CidrIp: '10.0.0.0/8' }],
        },
      ],
    });
  });

  it('warns before a rule opens the port to the entire internet', async () => {
    renderModal();
    await screen.findByLabelText('CIDR block');

    fireEvent.click(screen.getByLabelText(/Anywhere/));

    expect(await screen.findByText('This source is the entire internet')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    expect(dispatchedInput('AuthorizeSecurityGroupIngress')).toMatchObject({
      IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
    });
  });

  it('rejects prefix widths outside the family and accepts IPv6 shapes', async () => {
    renderModal();
    await screen.findByLabelText('CIDR block');

    fireEvent.click(screen.getByLabelText(/Custom IPv6 CIDR/));
    const cidrInput = screen.getByLabelText('CIDR block');
    fireEvent.change(cidrInput, { target: { value: '2001:db8::/129' } });
    expect(await screen.findByText(/Use IPv6 CIDR notation/)).toBeDefined();

    fireEvent.change(cidrInput, { target: { value: '2001:db8::/32' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add rule' }).hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    expect(dispatchedInput('AuthorizeSecurityGroupIngress')).toMatchObject({
      IpPermissions: [{ Ipv6Ranges: [{ CidrIpv6: '2001:db8::/32' }] }],
    });
  });

  it('allows another security group in the same VPC as the source', async () => {
    renderModal();
    await screen.findByLabelText('CIDR block');

    fireEvent.click(screen.getByLabelText(/^Security group/));
    const trigger = screen.getByRole('button', { name: /Source security group/ });
    await waitFor(() => {
      expect(trigger.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.mouseDown(trigger);
    selectOption('database');

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledTimes(1);
    });
    expect(dispatchedInput('AuthorizeSecurityGroupIngress')).toMatchObject({
      IpPermissions: [{ UserIdGroupPairs: [{ GroupId: 'sg-2' }] }],
    });
    // The source-group choices are scoped to the group's VPC.
    const describeInput = dispatchedInput('DescribeSecurityGroups');
    expect(describeInput).toMatchObject({
      Filters: [{ Name: 'vpc-id', Values: ['vpc-1'] }],
    });
  });
});
