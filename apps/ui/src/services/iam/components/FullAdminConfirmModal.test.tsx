// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullAdminConfirmModal } from './FullAdminConfirmModal';

describe('IAM FullAdminConfirmModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('disables both actions while a save is in flight so it cannot be repeated', () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    render(
      <FullAdminConfirmModal
        visible
        subject="policy"
        warnings={['Statement[0] allows every action.']}
        busy
        onDismiss={onDismiss}
        onConfirm={onConfirm}
      />,
    );

    const saveAnyway = screen.getByRole('button', { name: 'Save anyway' });
    expect(saveAnyway.hasAttribute('disabled')).toBe(true);
    fireEvent.click(saveAnyway);
    expect(onConfirm).not.toHaveBeenCalled();

    const goBack = screen.getByRole('button', { name: 'Go back' });
    expect(goBack.hasAttribute('disabled')).toBe(true);
    fireEvent.click(goBack);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('keeps the confirmation usable when idle', () => {
    const onConfirm = vi.fn();
    render(
      <FullAdminConfirmModal
        visible
        subject="policy"
        warnings={['Statement[0] allows every action.']}
        onDismiss={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
