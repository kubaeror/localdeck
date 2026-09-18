// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
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

  it('revokes a rule with its source group, prefix list and description intact', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: /web/ })).toBeDefined();
    // The rule's source column shows all three kinds of source.
    expect(await screen.findByText('10.0.0.0/16, pl-123, sg-app')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
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
