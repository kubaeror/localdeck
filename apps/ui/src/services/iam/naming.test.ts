import { describe, expect, it } from 'vitest';
import {
  validateGroupName,
  validatePolicyName,
  validateRoleName,
  validateUserName,
} from './naming';

describe('IAM name validation', () => {
  it('accepts names with the allowed character set', () => {
    expect(validateUserName('alice')).toBeNull();
    expect(validateUserName('svc.deploy+prod=1@example')).toBeNull();
    expect(validateGroupName('developers_2026')).toBeNull();
    expect(validateRoleName('lambda-execution-role')).toBeNull();
    expect(validatePolicyName('s3-read-only,v2')).toBeNull();
  });

  it('requires a name', () => {
    expect(validateUserName('')).toBe('Enter a user name.');
    expect(validateGroupName('')).toBe('Enter a group name.');
    expect(validateRoleName('')).toBe('Enter a role name.');
    expect(validatePolicyName('')).toBe('Enter a policy name.');
  });

  it('enforces the per-resource length limits', () => {
    expect(validateUserName('a'.repeat(64))).toBeNull();
    expect(validateUserName('a'.repeat(65))).toContain('at most 64');
    expect(validateGroupName('a'.repeat(129))).toContain('at most 128');
    expect(validateRoleName('a'.repeat(65))).toContain('at most 64');
    expect(validatePolicyName('a'.repeat(129))).toContain('at most 128');
  });

  it('rejects characters AWS does not allow', () => {
    expect(validateUserName('alice smith')).toContain('alphanumeric');
    expect(validateUserName('alice#1')).toContain('alphanumeric');
    expect(validateRoleName('role/name')).toContain('alphanumeric');
  });
});
