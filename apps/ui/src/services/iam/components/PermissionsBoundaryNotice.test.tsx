// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PermissionsBoundaryNotice } from './PermissionsBoundaryNotice';

describe('IAM PermissionsBoundaryNotice', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the reported boundary ARN and its policy type read-only', () => {
    render(
      <PermissionsBoundaryNotice
        entity="user"
        name="alice"
        boundary={{ arn: 'arn:aws:iam::000000000000:policy/boundary', scope: 'Local' }}
      />,
    );

    expect(screen.getByText('arn:aws:iam::000000000000:policy/boundary')).toBeDefined();
    expect(screen.getByText('Customer managed')).toBeDefined();
    const action = screen.getByRole('button', { name: 'Change permissions boundary' });
    expect(action.hasAttribute('disabled')).toBe(true);
  });

  it('labels an AWS managed boundary and explains the unavailable write action', () => {
    render(
      <PermissionsBoundaryNotice
        entity="role"
        name="lambda-role"
        boundary={{ arn: 'arn:aws:iam::aws:policy/PowerUserAccess', scope: 'AWS' }}
      />,
    );

    expect(screen.getByText('AWS managed')).toBeDefined();
    const action = screen.getByRole('button', { name: 'Change permissions boundary' });
    // Writes stay unavailable; the disabled reason is carried by the tooltip.
    expect(action.hasAttribute('disabled')).toBe(true);
  });

  it('says no boundary is set when GetUser/GetRole reported none', () => {
    render(<PermissionsBoundaryNotice entity="user" name="alice" />);

    expect(screen.getByText(/does not have a permissions boundary set/)).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Set permissions boundary' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
