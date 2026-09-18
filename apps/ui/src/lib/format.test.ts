import { describe, expect, it } from 'vitest';
import {
  describeServiceStatus,
  formatAvailability,
  formatBytes,
  formatDate,
  formatDateTime,
  formatLatency,
  formatRelativeTime,
  formatServiceName,
} from './format';

describe('formatBytes', () => {
  it('renders bytes, kibibytes and mebibytes', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(912)).toBe('912 bytes');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(12_845_056)).toBe('12.3 MiB');
  });

  it('falls back for invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('unknown');
    expect(formatBytes(-5)).toBe('unknown');
  });
});

describe('formatDateTime and formatDate', () => {
  it('reads timestamps in UTC, like LocalStack reports them', () => {
    expect(formatDateTime('2026-02-03T04:05:06.000Z')).toBe('February 3, 2026, 4:05:06 AM (UTC)');
    expect(formatDate('2026-02-03T04:05:06.000Z')).toBe('Feb 3, 2026');
  });

  it('renders a dash for missing or unparsable values', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('formatLatency', () => {
  it('renders milliseconds below one second', () => {
    expect(formatLatency(0)).toBe('0 ms');
    expect(formatLatency(142.4)).toBe('142 ms');
  });

  it('renders seconds above one second', () => {
    expect(formatLatency(1_400)).toBe('1.4 s');
  });

  it('falls back for invalid input', () => {
    expect(formatLatency(Number.NaN)).toBe('unknown');
    expect(formatLatency(-1)).toBe('unknown');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');

  it('describes recent timestamps', () => {
    expect(formatRelativeTime('2026-01-01T12:00:00.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-01-01T11:59:18.000Z', now)).toBe('42s ago');
    expect(formatRelativeTime('2026-01-01T11:57:00.000Z', now)).toBe('3m ago');
    expect(formatRelativeTime('2026-01-01T09:00:00.000Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2025-12-30T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('falls back for unparsable input', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('unknown');
  });
});

describe('formatAvailability', () => {
  it('summarizes service counts', () => {
    expect(formatAvailability(119, 119)).toBe('119 of 119 available');
    expect(formatAvailability(0, 0)).toBe('no services reported');
  });
});

describe('formatServiceName', () => {
  it('turns LocalStack service ids into readable names', () => {
    expect(formatServiceName('s3')).toBe('S3');
    expect(formatServiceName('apigatewayv2')).toBe('Apigatewayv2');
    expect(formatServiceName('cognito-idp')).toBe('Cognito Idp');
  });
});

describe('describeServiceStatus', () => {
  it('uses console wording', () => {
    expect(describeServiceStatus('available')).toBe('Available');
    expect(describeServiceStatus('starting')).toBe('Starting');
    expect(describeServiceStatus('unknown')).toBe('Unknown');
  });
});
