import { describe, expect, it } from 'vitest';
import {
  nextDeviceName,
  validateInstanceName,
  validateKeyPairName,
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from './naming';

describe('EC2 naming rules', () => {
  it('accepts an empty instance name (the instance shows its id)', () => {
    expect(validateInstanceName('')).toBeNull();
    expect(validateInstanceName('web-server')).toBeNull();
  });

  it('rejects reserved or blank instance names', () => {
    expect(validateInstanceName('aws:internal')).toContain('reserved');
    expect(validateInstanceName('   ')).toContain('non-space');
    expect(validateInstanceName('x'.repeat(257))).toContain('at most 256');
  });

  it('validates key pair names against the EC2 character set', () => {
    expect(validateKeyPairName('localdeck-key_1.2')).toBeNull();
    expect(validateKeyPairName('')).toContain('Enter a key pair name');
    expect(validateKeyPairName('bad name')).toContain('alphanumeric');
  });

  it('validates security group names and descriptions', () => {
    expect(validateSecurityGroupName('web-servers')).toBeNull();
    expect(validateSecurityGroupName('sg-1234')).toContain('cannot start with');
    expect(validateSecurityGroupName('')).toContain('Enter a security group name');
    expect(validateSecurityGroupName('bad/name')).toBeNull();
    expect(validateSecurityGroupName('bad*name')).toBeNull();
    expect(validateSecurityGroupName('bad^name')).toContain('characters');

    expect(validateSecurityGroupDescription('Allow HTTP traffic')).toBeNull();
    expect(validateSecurityGroupDescription('')).toContain('Enter a security group description');
  });

  it('picks the next free device name for an extra volume', () => {
    expect(nextDeviceName([])).toBe('/dev/sdf');
    expect(nextDeviceName(['/dev/sdf'])).toBe('/dev/sdg');
    expect(nextDeviceName(['/dev/sdf', '/dev/sdg'])).toBe('/dev/sdh');
  });
});
