import { describe, expect, it } from 'vitest';
import {
  CLUSTER_NAME_PATTERN,
  NODEGROUP_NAME_PATTERN,
  parsePositiveInteger,
  parseScalingValue,
  ROLE_ARN_PATTERN,
  validateClusterName,
  validateKubernetesVersion,
  validateNodegroupName,
  validateRoleArn,
  validateScaling,
} from './naming';

describe('EKS naming rules', () => {
  it('accepts the names the EKS API accepts', () => {
    expect(validateClusterName('localdeck-cluster_1')).toBeNull();
    expect(validateClusterName('A1')).toBeNull();
    expect(validateNodegroupName('ng-workers_2')).toBeNull();
    expect(CLUSTER_NAME_PATTERN.test('cluster-01')).toBe(true);
    expect(NODEGROUP_NAME_PATTERN.test('ng')).toBe(true);
  });

  it('rejects empty, over-long and punctuated names with actionable messages', () => {
    expect(validateClusterName('')).toContain('Enter a cluster name');
    expect(validateClusterName('a'.repeat(101))).toContain('100 characters');
    expect(validateClusterName('-starts-with-hyphen')).toContain(
      'starting with a letter or number',
    );
    expect(validateClusterName('has space')).toContain('letters, numbers');
    expect(validateNodegroupName('n'.repeat(64))).toContain('63 characters');
    expect(validateNodegroupName('bad.name')).toContain('hyphens and underscores');
  });

  it('validates Kubernetes versions', () => {
    expect(validateKubernetesVersion('1.36')).toBeNull();
    expect(validateKubernetesVersion('')).toContain('Select');
    expect(validateKubernetesVersion('v1.36')).toContain('look like 1.36');
  });

  it('enforces min ≤ desired ≤ max and whole numbers', () => {
    expect(validateScaling({ minSize: 1, maxSize: 3, desiredSize: 2 })).toBeNull();
    expect(validateScaling({ minSize: 2, maxSize: 3, desiredSize: 1 })).toContain('Minimum size');
    expect(validateScaling({ minSize: 1, maxSize: 2, desiredSize: 3 })).toContain('Desired size');
    expect(validateScaling({ minSize: 1, maxSize: 2000, desiredSize: 1 })).toContain('1000 nodes');
    expect(validateScaling({ minSize: 1, maxSize: 2, desiredSize: Number.NaN })).toContain(
      'whole number',
    );
  });

  it('parses form values without inventing numbers', () => {
    expect(parseScalingValue('12')).toBe(12);
    expect(Number.isNaN(parseScalingValue(''))).toBe(true);
    expect(Number.isNaN(parseScalingValue('two'))).toBe(true);
    // Strict integers: `parseInt` would accept these as 3.
    expect(Number.isNaN(parseScalingValue('3.9'))).toBe(true);
    expect(Number.isNaN(parseScalingValue('3abc'))).toBe(true);
    expect(Number.isNaN(parseScalingValue('-1'))).toBe(true);
  });

  it('parses optional positive integers and rejects partial numbers', () => {
    expect(parsePositiveInteger('')).toBeUndefined();
    expect(parsePositiveInteger('20')).toBe(20);
    expect(Number.isNaN(parsePositiveInteger('0'))).toBe(true);
    expect(Number.isNaN(parsePositiveInteger('3.9'))).toBe(true);
    expect(Number.isNaN(parsePositiveInteger('3abc'))).toBe(true);
  });

  it('validates role ARNs before they are sent to EKS', () => {
    expect(validateRoleArn('arn:aws:iam::000000000000:role/eks-cluster-role')).toBeNull();
    expect(validateRoleArn('arn:aws-us-gov:iam::123456789012:role/path/role')).toBeNull();
    expect(ROLE_ARN_PATTERN.test('arn:aws:iam::000000000000:role/r')).toBe(true);
    expect(validateRoleArn('')).toContain('Select or enter');
    expect(validateRoleArn('eks-cluster-role')).toContain('role ARN');
    expect(validateRoleArn('arn:aws:iam::12:role/short-account')).toContain('role ARN');
  });
});
