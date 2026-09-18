// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceActionModal, type InstanceAction } from './InstanceActionModal';
import type { Ec2Instance } from '../api';

function instance(overrides: Partial<Ec2Instance> = {}): Ec2Instance {
  return {
    instanceId: 'i-0123456789abcdef0',
    name: 'alpha',
    state: 'running',
    instanceType: 't3.micro',
    securityGroups: [],
    blockDevices: [],
    tags: [],
    raw: {},
    ...overrides,
  };
}

function renderModal(
  action: InstanceAction,
  instances: readonly Ec2Instance[] = [instance()],
): {
  onConfirm: ReturnType<typeof vi.fn>;
  onDismiss: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  const onDismiss = vi.fn();
  render(
    <InstanceActionModal
      visible
      action={action}
      instances={instances}
      onDismiss={onDismiss}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onDismiss };
}

describe('InstanceActionModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('confirms a reversible action in one click', () => {
    const { onConfirm } = renderModal('start');

    expect(screen.getByText('Start instance')).toBeDefined();
    const submit = screen.getByRole('button', { name: 'Start' });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps terminate locked until the instance ID is typed', () => {
    const { onConfirm } = renderModal('terminate');

    const submit = screen.getByRole('button', { name: 'Terminate instance' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm terminate of i-0123456789abcdef0'), {
      target: { value: 'i-wrong' },
    });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm terminate of i-0123456789abcdef0'), {
      target: { value: 'i-0123456789abcdef0' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('asks bulk terminations to type "terminate" and lists every instance', () => {
    renderModal('terminate', [instance(), instance({ instanceId: 'i-2', name: 'beta' })]);

    expect(screen.getByText('beta')).toBeDefined();
    expect(screen.getByText(/2 instances are affected/)).toBeDefined();

    const submit = screen.getByRole('button', { name: 'Terminate instances' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/Confirm terminate of i-0123456789abcdef0, i-2/), {
      target: { value: 'terminate' },
    });
    expect(submit.hasAttribute('disabled')).toBe(false);
  });
});
