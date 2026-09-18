import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactElement } from 'react';
import type { ConnectionPhase } from '../contexts/localstack-status-context';

export interface ConnectionStatusIndicatorProps {
  /** Connection phase reported by the LocalStack status provider. */
  phase: ConnectionPhase;
}

/**
 * The single mapping from the LocalStack connection phase to console wording
 * and status color. The health page, the Console Home widget and the About
 * dialog all render this instead of maintaining three copies.
 */
export function ConnectionStatusIndicator({ phase }: ConnectionStatusIndicatorProps): ReactElement {
  switch (phase) {
    case 'connected':
      return <StatusIndicator type="success">Connected</StatusIndicator>;
    case 'degraded':
      return <StatusIndicator type="warning">Connected, degraded</StatusIndicator>;
    case 'unreachable':
      return <StatusIndicator type="error">LocalStack unreachable</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">LocalDeck api error</StatusIndicator>;
    default:
      return <StatusIndicator type="in-progress">Checking</StatusIndicator>;
  }
}
