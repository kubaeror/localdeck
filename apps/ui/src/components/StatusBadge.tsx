import type { LocalStackServiceStatus } from '@localdeck/shared';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import type { ReactElement } from 'react';
import { describeStatus, type ResourceStatus, type StatusName } from '../lib/format';

const INDICATOR_TYPES: Readonly<Record<StatusName, StatusIndicatorProps.Type>> = {
  // LocalStack service statuses
  available: 'success',
  starting: 'in-progress',
  error: 'error',
  disabled: 'stopped',
  unknown: 'info',
  // Resource lifecycle states
  running: 'success',
  pending: 'in-progress',
  stopped: 'stopped',
  stopping: 'in-progress',
  'shutting-down': 'in-progress',
  terminated: 'stopped',
  'in-use': 'success',
  creating: 'in-progress',
  active: 'success',
  updating: 'in-progress',
  deleted: 'stopped',
  deleting: 'in-progress',
  'create-failed': 'error',
  'delete-failed': 'error',
  degraded: 'warning',
  failed: 'error',
};

export interface StatusBadgeProps {
  /** A LocalStack service status or an AWS resource lifecycle state. */
  status: LocalStackServiceStatus | ResourceStatus;
  /** Overrides the console wording, e.g. "Stopping (2 remaining)". */
  label?: string;
}

/**
 * Renders every state the console shows through one StatusIndicator mapping,
 * with the wording the AWS console uses.
 */
export function StatusBadge({ status, label }: StatusBadgeProps): ReactElement {
  return (
    <StatusIndicator type={INDICATOR_TYPES[status]}>
      {label ?? describeStatus(status)}
    </StatusIndicator>
  );
}
