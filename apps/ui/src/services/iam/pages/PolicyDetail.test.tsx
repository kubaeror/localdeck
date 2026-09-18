// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { stubApiFetch } from '../../../test/fixtures';
import { PolicyDetailPage } from './PolicyDetail';

const IAM = ((): ServiceDescriptor => {
  const service = findService('iam');
  if (service === undefined) throw new Error('iam must be registered');
  return service;
})();

const POLICY_ARN = 'arn:aws:iam::000000000000:policy/read-only';
const POLICY_DOCUMENT = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['s3:GetObject'], Resource: ['arn:aws:s3:::b/*'] }],
  },
  null,
  2,
);

function renderDetail(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={[`/console/iam/policies/${encodeURIComponent(POLICY_ARN)}`]}>
        <Routes>
          <Route
            path="/console/iam/policies/:policyArn"
            element={<PolicyDetailPage descriptor={IAM} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('IAM PolicyDetailPage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'iam/GetPolicy': {
          service: 'iam',
          operation: 'GetPolicy',
          result: {
            Policy: {
              PolicyName: 'read-only',
              Arn: POLICY_ARN,
              DefaultVersionId: 'v1',
              AttachmentCount: 2,
              IsAttachable: true,
              UpdateDate: '2026-02-01T00:00:00.000Z',
            },
          },
        },
        'iam/GetPolicyVersion': {
          service: 'iam',
          operation: 'GetPolicyVersion',
          result: { PolicyVersion: { Document: encodeURIComponent(POLICY_DOCUMENT) } },
        },
        'iam/ListEntitiesForPolicy': {
          service: 'iam',
          operation: 'ListEntitiesForPolicy',
          result: {
            PolicyUsers: [{ UserName: 'alice' }],
            PolicyRoles: [{ RoleName: 'lambda-role' }],
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('decodes the ARN route parameter and renders the policy document', async () => {
    renderDetail();

    // The h1 shows the decoded policy name, not the percent-encoded ARN segment.
    expect(await screen.findByRole('heading', { level: 1, name: 'read-only' })).toBeDefined();
    expect(screen.getByText(POLICY_ARN)).toBeDefined();
    // The document is rendered read-only and pretty-printed.
    expect(await screen.findByRole('heading', { level: 2, name: 'Policy document' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Edit policy' })).toBeDefined();
    expect(screen.getByText(/v1/)).toBeDefined();
  });

  it('lists the entities the policy is attached to', async () => {
    renderDetail();
    await screen.findByRole('heading', { level: 1, name: 'read-only' });

    fireEvent.click(screen.getByRole('tab', { name: 'Attached entities' }));

    const usersTable = await screen.findByRole('table', { name: /Users/ });
    expect(within(usersTable).getByRole('link', { name: 'alice' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'lambda-role' })).toBeDefined();
    expect(screen.getByText(/No groups are attached/)).toBeDefined();
  });
});
