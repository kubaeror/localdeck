import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactElement } from 'react';
import type { ConnectionPhase } from '../contexts/emulator-status-context';

export interface ConnectionStatusIndicatorProps {
  /** Connection phase reported by the emulator status provider. */
  phase: ConnectionPhase;
  /** Display name of the active emulator ("LocalStack", "MiniStack", "Floci"). */
  providerLabel?: string;
}

/**
 * The single mapping from the emulator connection phase to console wording
 * and status color. The health page, the Console Home widget and the About
 * dialog all render this instead of maintaining three copies.
 */
export function ConnectionStatusIndicator({
  phase,
  providerLabel = 'Emulator',
}: ConnectionStatusIndicatorProps): ReactElement {
  switch (phase) {
    case 'connected':
      return <StatusIndicator type="success">Connected</StatusIndicator>;
    case 'degraded':
      return <StatusIndicator type="warning">Connected, degraded</StatusIndicator>;
    case 'unreachable':
      return <StatusIndicator type="error">{providerLabel} unreachable</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">LocalDeck api error</StatusIndicator>;
    default:
      return <StatusIndicator type="in-progress">Checking</StatusIndicator>;
  }
}
