// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, jsonResponse, stubApiFetch } from '../../../test/fixtures';
import { SecurityGroupDetailPage } from './SecurityGroupDetail';

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

const GROUP = {
  service: 'ec2',
  operation: 'DescribeSecurityGroups',
  result: {
    SecurityGroups: [
      {
        GroupId: 'sg-web',
        GroupName: 'web',
        Description: 'web tier',
        VpcId: 'vpc-1',
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            Description: 'application tier',
            IpRanges: [{ CidrIp: '10.0.0.0/16' }],
            PrefixListIds: [{ PrefixListId: 'pl-123' }],
            UserIdGroupPairs: [{ GroupId: 'sg-app' }],
          },
        ],
        IpPermissionsEgress: [
          {
            IpProtocol: '-1',
            IpRanges: [{ CidrIp: '0.0.0.0/0' }],
          },
        ],
      },
    ],
  },
};

const TWO_RULES = {
  service: 'ec2',
  operation: 'DescribeSecurityGroups',
  result: {
    SecurityGroups: [
      {
        GroupId: 'sg-web',
        GroupName: 'web',
        Description: 'web tier',
        VpcId: 'vpc-1',
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [{ CidrIp: '10.0.0.0/16' }],
          },
          {
            IpProtocol: 'tcp',
            FromPort: 80,
            ToPort: 80,
            IpRanges: [{ CidrIp: '0.0.0.0/0' }],
          },
        ],
      },
    ],
  },
};

function renderDetail(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/ec2/security-groups/sg-web']}>
        <Routes>
          <Route
            path="/console/ec2/security-groups/:groupId"
            element={<SecurityGroupDetailPage descriptor={{ ...EC2_DESCRIPTOR }} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

/** Types the modal's confirmation text and clicks the destructive button. */
async function confirmModal(buttonName: string): Promise<void> {
  const modal = await screen.findByRole('dialog');
  const confirm = within(modal).getByRole('button', { name: buttonName });
  expect(confirm.hasAttribute('disabled')).toBe(true);
  fireEvent.change(within(modal).getByLabelText(/Confirm deletion of/), {
    target: { value: 'revoke' },
  });
  expect(confirm.hasAttribute('disabled')).toBe(false);
  fireEvent.click(confirm);
}

describe('EC2 SecurityGroupDetailPage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/DescribeSecurityGroups': GROUP,
        'ec2/RevokeSecurityGroupIngress': {
          service: 'ec2',
          operation: 'RevokeSecurityGroupIngress',
          result: {},
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('revokes a rule only after the typed confirmation, with its source group, prefix list and description intact', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: /web/ })).toBeDefined();
    // The rule's source column shows all three kinds of source.
    expect(await screen.findByText('10.0.0.0/16, pl-123, sg-app')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

    // Opening the confirmation must not call the API.
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('Revoke inbound rule')).toBeDefined();
    expect(
      within(modal).getByText(/TCP port 443 from 10\.0\.0\.0\/16, pl-123, sg-app/),
    ).toBeDefined();
    expect(dispatchedOperationCalls('ec2', 'RevokeSecurityGroupIngress')).toBe(0);

    await confirmModal('Revoke rule');
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'RevokeSecurityGroupIngress')).toBe(1);
    });

    const call = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([input]) =>
        String(input).includes('/api/services/ec2/RevokeSecurityGroupIngress'),
      );
    const request = JSON.parse(String(call?.[1]?.body)) as { input: Record<string, unknown> };
    expect(request.input).toMatchObject({
      GroupId: 'sg-web',
      IpPermissions: [
        {
          IpProtocol: 'tcp',
          FromPort: 443,
          ToPort: 443,
          Description: 'application tier',
          IpRanges: [{ CidrIp: '10.0.0.0/16' }],
          PrefixListIds: [{ PrefixListId: 'pl-123' }],
          UserIdGroupPairs: [{ GroupId: 'sg-app' }],
        },
      ],
    });
  }, 15_000);

  it('loads only the rule being revoked instead of every row', async () => {
    stubApiFetch({
      operations: {
        'ec2/DescribeSecurityGroups': TWO_RULES,
        'ec2/RevokeSecurityGroupIngress': {
          service: 'ec2',
          operation: 'RevokeSecurityGroupIngress',
          result: {},
        },
      },
    });

    // Hold the revoke response open, so the per-row loading state is observable.
    let releaseRevoke: () => void = () => undefined;
    const pendingRevoke = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    const baseImplementation = vi.mocked(globalThis.fetch).getMockImplementation();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/api/services/ec2/RevokeSecurityGroupIngress')) {
        await pendingRevoke;
        return jsonResponse({
          service: 'ec2',
          operation: 'RevokeSecurityGroupIngress',
          result: {},
        });
      }
      if (baseImplementation === undefined) throw new Error('missing base fetch stub');
      return baseImplementation(input, init);
    });

    renderDetail();
    const revokeButtons = await screen.findAllByRole('button', { name: 'Revoke' });
    expect(revokeButtons).toHaveLength(2);

    fireEvent.click(revokeButtons[0] as HTMLElement);
    await confirmModal('Revoke rule');

    await waitFor(() => {
      expect(revokeButtons[0]?.getAttribute('aria-disabled')).toBe('true');
    });
    // The other rule keeps its button idle: the in-flight state is per row.
    expect(revokeButtons[1]?.getAttribute('aria-disabled')).toBeNull();

    await act(async () => {
      releaseRevoke();
    });
  }, 15_000);

  it('renders the outbound add action disabled with an explanation', async () => {
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: /web/ });

    fireEvent.click(screen.getByRole('tab', { name: 'Outbound rules' }));
    const addOutbound = await screen.findByRole('button', { name: 'Add outbound rule' });
    expect(addOutbound.hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByLabelText(
        'This LocalDeck module manages inbound rules only. Outbound rules are shown read-only; AuthorizeSecurityGroupEgress is not part of the EC2 whitelist.',
      ),
    ).toBeDefined();
  }, 15_000);
});
