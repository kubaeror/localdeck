// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders AWS resource states with console wording', () => {
    const cases: readonly [Parameters<typeof StatusBadge>[0]['status'], string][] = [
      ['running', 'Running'],
      ['pending', 'Pending'],
      ['stopped', 'Stopped'],
      ['stopping', 'Stopping'],
      ['shutting-down', 'Shutting down'],
      ['terminated', 'Terminated'],
      ['deleting', 'Deleting'],
      ['degraded', 'Degraded'],
      ['failed', 'Failed'],
    ];

    for (const [status, label] of cases) {
      cleanup();
      render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeDefined();
    }
  });

  it('keeps rendering LocalStack service statuses', () => {
    render(<StatusBadge status={'available'} />);
    expect(screen.getByText('Available')).toBeDefined();
    cleanup();
    render(<StatusBadge status={'disabled'} />);
    expect(screen.getByText('Disabled')).toBeDefined();
    cleanup();
    render(<StatusBadge status={'starting'} />);
    expect(screen.getByText('Starting')).toBeDefined();
  });

  it('accepts a label override', () => {
    render(<StatusBadge status="pending" label="Pending (2 of 3 nodes ready)" />);
    expect(screen.getByText('Pending (2 of 3 nodes ready)')).toBeDefined();
  });
});
