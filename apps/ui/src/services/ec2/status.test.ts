import { describe, expect, it } from 'vitest';
import { imageStatusName, volumeStatusName } from './status';

describe('volumeStatusName', () => {
  it('maps every EBS volume state without turning a failure green', () => {
    expect(volumeStatusName('creating')).toBe('creating');
    expect(volumeStatusName('available')).toBe('available');
    expect(volumeStatusName('in-use')).toBe('in-use');
    expect(volumeStatusName('deleting')).toBe('deleting');
    expect(volumeStatusName('deleted')).toBe('deleted');
    expect(volumeStatusName('error')).toBe('error');
  });

  it('maps an unrecognized state to unknown, never available', () => {
    expect(volumeStatusName('hibernating')).toBe('unknown');
    expect(volumeStatusName('')).toBe('unknown');
    expect(volumeStatusName('ERROR')).toBe('unknown');
  });
});

describe('imageStatusName', () => {
  it('maps the AMI states the console shows', () => {
    expect(imageStatusName('available')).toBe('available');
    expect(imageStatusName('pending')).toBe('pending');
    expect(imageStatusName('failed')).toBe('failed');
    expect(imageStatusName('deregistered')).toBe('deleted');
  });

  it('maps missing and unknown states to unknown', () => {
    expect(imageStatusName(undefined)).toBe('unknown');
    expect(imageStatusName('weird')).toBe('unknown');
  });
});
