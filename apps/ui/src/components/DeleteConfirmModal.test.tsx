// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteConfirmModal } from './DeleteConfirmModal';

describe('DeleteConfirmModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the destructive button disabled until the subject is typed', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmModal
        visible
        title="Delete bucket"
        subjects={['my-bucket']}
        description="This cannot be undone."
        onDismiss={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(submit);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my-bucket' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('requires "delete" for a bulk selection and lists how many are affected', () => {
    render(
      <DeleteConfirmModal
        visible
        title="Delete buckets"
        subjects={['one', 'two', 'three']}
        description="Buckets must be empty."
        confirmationText="delete"
        submitLabel="Delete buckets"
        onDismiss={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByText('3 resources are affected by this deletion.')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one' } });
    const submit = screen.getByRole('button', { name: 'Delete buckets' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'delete' } });
    expect(submit.disabled).toBe(false);
  });

  it('renders the delete failure inside the modal', () => {
    render(
      <DeleteConfirmModal
        visible
        title="Delete bucket"
        subjects={['my-bucket']}
        description="This cannot be undone."
        errorText="The bucket is not empty."
        onDismiss={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByText('The bucket is not empty.')).toBeDefined();
  });
});
