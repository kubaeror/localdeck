import { describe, expect, it } from 'vitest';
import {
  isApiErrorResponse,
  normalizeLocalStackServiceStatus,
  summarizeServiceAvailability,
} from '../src/index.js';

describe('normalizeLocalStackServiceStatus', () => {
  it('keeps the statuses LocalStack documents', () => {
    for (const status of ['available', 'running', 'starting', 'error', 'disabled'] as const) {
      expect(normalizeLocalStackServiceStatus(status)).toBe(status);
    }
  });

  it('maps anything unknown to "unknown"', () => {
    expect(normalizeLocalStackServiceStatus('weird')).toBe('unknown');
    expect(normalizeLocalStackServiceStatus(null)).toBe('unknown');
    expect(normalizeLocalStackServiceStatus(42)).toBe('unknown');
  });
});

describe('summarizeServiceAvailability', () => {
  it('counts available, errored and everything else', () => {
    expect(
      summarizeServiceAvailability({
        s3: 'available',
        lambda: 'running',
        dynamodb: 'error',
        rds: 'disabled',
        ecs: 'starting',
      }),
    ).toEqual({ total: 5, available: 2, error: 1, other: 2 });
  });

  it('handles an empty snapshot', () => {
    expect(summarizeServiceAvailability({})).toEqual({
      total: 0,
      available: 0,
      error: 0,
      other: 0,
    });
  });
});

describe('isApiErrorResponse', () => {
  it('accepts the shared error shape', () => {
    expect(
      isApiErrorResponse({
        error: { code: 'LOCALSTACK_UNREACHABLE', message: 'down', statusCode: 503 },
      }),
    ).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isApiErrorResponse({ error: { code: 'X' } })).toBe(false);
    expect(isApiErrorResponse(null)).toBe(false);
    expect(isApiErrorResponse('<html>')).toBe(false);
  });
});
