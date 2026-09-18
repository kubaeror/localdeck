import type { LocalStackServiceStatus } from '@localdeck/shared';

/** "142 ms" / "1.4 s" */
export function formatLatency(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'unknown';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

const BYTE_UNITS = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

/** "0 bytes" / "912 bytes" / "12.4 KiB" / "1.2 GiB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

/**
 * The console's absolute timestamp: "February 3, 2026, 4:05:06 AM (UTC)".
 * LocalStack runs in UTC, so the console reads times in the same zone the
 * emulator reports them in. Date and time are formatted separately so the
 * output does not depend on ICU's date/time separator.
 */
export function formatDateTime(value: string | Date | undefined): string {
  if (value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date);
  return `${day}, ${time} (UTC)`;
}

/** "2026-01-02" — compact date for narrow table columns. */
export function formatDate(value: string | Date | undefined): string {
  if (value === undefined) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/** "just now" / "42s ago" / "3m ago" / "2h ago" */
export function formatRelativeTime(isoTimestamp: string, now: number = Date.now()): string {
  const timestamp = Date.parse(isoTimestamp);
  if (Number.isNaN(timestamp)) return 'unknown';

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "119 of 119 available" */
export function formatAvailability(available: number, total: number): string {
  if (total === 0) return 'no services reported';
  return `${available} of ${total} available`;
}

export function formatServiceName(serviceId: string): string {
  return serviceId
    .split('-')
    .map((part) => (part.length > 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

/**
 * Resource lifecycle states the console renders. Wording matches the AWS
 * console exactly (running / pending / stopped / stopping / shutting-down /
 * terminated, the EBS volume states, degraded / failed).
 */
export type ResourceStatus =
  | 'running'
  | 'pending'
  | 'stopped'
  | 'stopping'
  | 'shutting-down'
  | 'terminated'
  | 'in-use'
  | 'creating'
  | 'active'
  | 'updating'
  | 'deleted'
  | 'deleting'
  | 'create-failed'
  | 'delete-failed'
  | 'degraded'
  | 'failed'
  | 'unknown';

export type StatusName = LocalStackServiceStatus | ResourceStatus;

/** LocalStack service statuses are a subset of the console's status vocabulary. */
export function describeServiceStatus(status: LocalStackServiceStatus): string {
  return describeStatus(status);
}

/** Any status the console can render, in console wording. */
export function describeStatus(status: StatusName): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'stopped':
      return 'Stopped';
    case 'stopping':
      return 'Stopping';
    case 'shutting-down':
      return 'Shutting down';
    case 'terminated':
      return 'Terminated';
    case 'in-use':
      return 'In use';
    case 'creating':
      return 'Creating';
    case 'active':
      return 'Active';
    case 'updating':
      return 'Updating';
    case 'deleted':
      return 'Deleted';
    case 'deleting':
      return 'Deleting';
    case 'create-failed':
      return 'Create failed';
    case 'delete-failed':
      return 'Delete failed';
    case 'degraded':
      return 'Degraded';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Running';
    case 'available':
      return 'Available';
    case 'starting':
      return 'Starting';
    case 'error':
      return 'Error';
    case 'disabled':
      return 'Disabled';
    default:
      return 'Unknown';
  }
}
