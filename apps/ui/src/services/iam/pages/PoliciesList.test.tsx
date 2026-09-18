// @vitest-environment jsdom
import { findService, type ServiceDescriptor } from '@localdeck/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { PoliciesListPage } from './PoliciesList';

const IAM = ((): ServiceDescriptor => {
  const service = findService('iam');
  if (service === undefined) throw new Error('iam must be registered');
  return service;
})();

const POLICY_RESULT = {
  service: 'iam',
  operation: 'ListPolicies',
  result: {
    Policies: [
      {
        PolicyName: 'read-only',
        Arn: 'arn:aws:iam::000000000000:policy/read-only',
        DefaultVersionId: 'v1',
        AttachmentCount: 2,
        IsAttachable: true,
        CreateDate: '2026-01-02T03:04:05.000Z',
      },
      {
        PolicyName: 'read-write',
        Arn: 'arn:aws:iam::000000000000:policy/read-write',
        DefaultVersionId: 'v1',
        AttachmentCount: 0,
        IsAttachable: true,
      },
    ],
    IsTruncated: false,
  },
};

function renderList(): void {
  render(
    <FlashbarProvider>
      <MemoryRouter initialEntries={['/console/iam/policies']}>
        <PoliciesListPage descriptor={IAM} />
      </MemoryRouter>
    </FlashbarProvider>,
  );
}

describe('IAM PoliciesListPage', () => {
  beforeEach(() => {
    stubApiFetch({ operations: { 'iam/ListPolicies': POLICY_RESULT } });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders policy names, types and attachment counts', async () => {
    renderList();

    expect(await screen.findByRole('heading', { level: 1, name: 'Policies' })).toBeDefined();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('read-only')).toBeDefined();
    expect(within(table).getAllByText('Customer managed').length).toBeGreaterThan(0);
    expect(within(table).getByText('2')).toBeDefined();
    expect(within(table).getByText('0')).toBeDefined();
  });

  it('filters by name and switches to the AWS managed scope', async () => {
    renderList();
    await screen.findByText('read-only');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter policies' }), {
      target: { value: 'read-write' },
    });
    expect(screen.queryByText('read-only')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'AWS managed' }));
    await waitFor(() => {
      expect(dispatchedOperationCalls('iam', 'ListPolicies')).toBeGreaterThan(1);
    });
    expect(await screen.findByText('read-write')).toBeDefined();
    // The stub answers every scope with the same policies; the console labels
    // them by the scope it requested.
    expect(screen.getAllByText('AWS managed').length).toBeGreaterThan(0);
  });
});
