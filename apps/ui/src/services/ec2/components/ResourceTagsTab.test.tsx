// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { dispatchedOperationCalls, stubApiFetch } from '../../../test/fixtures';
import { ResourceTagsTab } from './ResourceTagsTab';

function renderTab(): void {
  render(
    <FlashbarProvider>
      <ResourceTagsTab resourceId="i-1" tags={[]} />
    </FlashbarProvider>,
  );
}

describe('EC2 ResourceTagsTab', () => {
  beforeEach(() => {
    stubApiFetch({
      operations: {
        'ec2/CreateTags': { service: 'ec2', operation: 'CreateTags', result: {} },
        'ec2/DeleteTags': { service: 'ec2', operation: 'DeleteTags', result: {} },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps Save changes disabled and skips the call while a tag row is invalid', async () => {
    renderTab();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getByLabelText('Tag value 1'), { target: { value: 'oops' } });

    // The draft changed, but its empty key keeps the save blocked.
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText(/Tag keys cannot be empty or whitespace/).length).toBeGreaterThan(0);
    fireEvent.click(save);
    expect(dispatchedOperationCalls('ec2', 'CreateTags')).toBe(0);

    fireEvent.change(screen.getByLabelText('Tag key 1'), { target: { value: 'env' } });
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(dispatchedOperationCalls('ec2', 'CreateTags')).toBe(1);
    });
  });
});
