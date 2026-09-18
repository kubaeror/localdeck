import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import type { ConnectionPhase } from '../contexts/localstack-status-context';

describe('ConnectionStatusIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it.each<[ConnectionPhase, string]>([
    ['connected', 'Connected'],
    ['degraded', 'Connected, degraded'],
    ['unreachable', 'LocalStack unreachable'],
    ['error', 'LocalDeck api error'],
    ['loading', 'Checking'],
  ])('renders %s as "%s"', (phase, label) => {
    render(<ConnectionStatusIndicator phase={phase} />);

    expect(screen.getByText(label)).toBeDefined();
  });
});
