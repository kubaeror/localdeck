// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { stubApiFetch } from '../../../test/fixtures';
import { UserDetailPage } from './UserDetail';

const IAM = ((): ServiceDescriptor => {
  const service = findService('iam');
  if (service === undefined) throw new Error('iam must be registered');
  return service;
})();

const USER_ARN = 'arn:aws:iam::000000000000:user/alice';
const BOUNDARY_ARN = 'arn:aws:iam::000000000000:policy/boundary';

function renderDetail(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/iam/users/alice']}>
        <Routes>
          <Route
            path="/console/iam/users/:userName"
            element={<UserDetailPage descriptor={IAM} />}
          />
        </Routes>
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('IAM UserDetailPage', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'iam/GetUser': {
          service: 'iam',
          operation: 'GetUser',
          result: {
            User: {
              UserName: 'alice',
              Arn: USER_ARN,
              CreateDate: '2026-01-02T03:04:05.000Z',
              PermissionsBoundary: {
                PermissionsBoundaryType: 'Policy',
                PermissionsBoundaryArn: BOUNDARY_ARN,
              },
              Tags: [{ Key: 'team', Value: 'core' }],
            },
          },
        },
        'iam/ListAttachedUserPolicies': {
          service: 'iam',
          operation: 'ListAttachedUserPolicies',
          result: {
            AttachedPolicies: [
              { PolicyName: 'ReadOnlyAccess', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' },
            ],
          },
        },
        'iam/ListGroupsForUser': {
          service: 'iam',
          operation: 'ListGroupsForUser',
          result: { Groups: [{ GroupName: 'developers' }] },
        },
        'iam/ListAccessKeys': {
          service: 'iam',
          operation: 'ListAccessKeys',
          result: {
            AccessKeyMetadata: [
              {
                AccessKeyId: 'AKIAEXAMPLE',
                Status: 'Active',
                CreateDate: '2026-02-01T00:00:00.000Z',
              },
            ],
          },
        },
        'iam/ListUserTags': {
          service: 'iam',
          operation: 'ListUserTags',
          result: { Tags: [{ Key: 'team', Value: 'core' }] },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the user header and every tab the acceptance criteria name', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'alice' })).toBeDefined();
    expect(screen.getByText(USER_ARN)).toBeDefined();

    // Permissions tab (default): the attached AWS managed policy.
    const policiesTable = await screen.findByRole('table', { name: 'Attached policies' });
    expect(within(policiesTable).getByRole('link', { name: 'ReadOnlyAccess' })).toBeDefined();
    expect(within(policiesTable).getByText('AWS managed')).toBeDefined();
    // GetUser reports the permissions boundary; the notice renders it read-only.
    expect(screen.getByText(BOUNDARY_ARN)).toBeDefined();
    expect(screen.getByText('Customer managed')).toBeDefined();

    // Groups tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    const groupsTable = await screen.findByRole('table', { name: 'Groups' });
    expect(within(groupsTable).getByRole('link', { name: 'developers' })).toBeDefined();

    // Security credentials tab: the access key with its status and actions.
    fireEvent.click(screen.getByRole('tab', { name: 'Security credentials' }));
    const keysTable = await screen.findByRole('table', { name: 'Access keys' });
    expect(within(keysTable).getByText('AKIAEXAMPLE')).toBeDefined();
    expect(within(keysTable).getByText('Active')).toBeDefined();
    expect(within(keysTable).getByRole('button', { name: 'Deactivate' })).toBeDefined();
    expect(within(keysTable).getByRole('button', { name: 'Delete' })).toBeDefined();

    // Tags tab: the editor holds the loaded key/value pair.
    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));
    expect(await screen.findByDisplayValue('team')).toBeDefined();
    expect(screen.getByDisplayValue('core')).toBeDefined();
  });
});
