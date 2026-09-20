import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import type { ConnectionPhase } from '../contexts/emulator-status-context';

describe('ConnectionStatusIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it.each<[ConnectionPhase, string]>([
    ['connected', 'Connected'],
    ['degraded', 'Connected, degraded'],
    ['unreachable', 'Emulator unreachable'],
    ['error', 'LocalDeck api error'],
    ['loading', 'Checking'],
  ])('renders %s as "%s"', (phase, label) => {
    render(<ConnectionStatusIndicator phase={phase} />);

    expect(screen.getByText(label)).toBeDefined();
  });

  it('names the active provider when one is known', () => {
    render(<ConnectionStatusIndicator phase="unreachable" providerLabel="MiniStack" />);
    expect(screen.getByText('MiniStack unreachable')).toBeDefined();
  });
});
