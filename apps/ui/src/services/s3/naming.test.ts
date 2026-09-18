import { describe, expect, it } from 'vitest';
import {
  bucketNameRules,
  needsLocationConstraint,
  normalizePrefix,
  S3_REGIONS,
  validateBucketName,
  validateObjectKey,
} from './naming';

describe('validateBucketName', () => {
  it('accepts names that follow the general-purpose rules', () => {
    expect(validateBucketName('my-bucket')).toBeNull();
    expect(validateBucketName('my.bucket-2026')).toBeNull();
    expect(validateBucketName('abc')).toBeNull();
    expect(validateBucketName('a'.repeat(63))).toBeNull();
  });

  it('reports the problems in console wording', () => {
    expect(validateBucketName('')).toBe('Enter a bucket name.');
    expect(validateBucketName('ab')).toContain('at least 3 characters');
    expect(validateBucketName('a'.repeat(64))).toContain('no more than 63 characters');
    expect(validateBucketName('MyBucket')).toContain('only contain lowercase letters');
    expect(validateBucketName('-bucket')).toContain('begin and end with a letter or number');
    expect(validateBucketName('bucket-')).toContain('begin and end with a letter or number');
    expect(validateBucketName('my..bucket')).toContain('two adjacent periods');
    expect(validateBucketName('192.168.5.4')).toContain('IP address');
    expect(validateBucketName('xn--bucket')).toContain('xn--');
    expect(validateBucketName('sthree-bucket')).toContain('sthree-');
    expect(validateBucketName('my-bucket-s3alias')).toContain('-s3alias');
    expect(validateBucketName('my-bucket--table-s3')).toContain('--table-s3');
  });

  it('does not mistake a dotted name for an IP address', () => {
    expect(validateBucketName('192.168.5.4.example')).toBeNull();
    expect(validateBucketName('999.1.1.1')).toBeNull();
  });

  it('documents every rule as constraint text', () => {
    const rules = bucketNameRules();
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(rules.join(' ')).toContain('63 characters');
  });
});

describe('regions', () => {
  it('only needs a location constraint outside us-east-1', () => {
    expect(needsLocationConstraint('us-east-1')).toBe(false);
    expect(needsLocationConstraint('eu-west-1')).toBe(true);
    expect(S3_REGIONS).toContain('us-east-1');
    expect(S3_REGIONS).toContain('eu-west-1');
  });
});

describe('keys and prefixes', () => {
  it('validates object keys', () => {
    expect(validateObjectKey('folder/object.txt')).toBeNull();
    expect(validateObjectKey('   ')).toBe('Enter an object key.');
    expect(validateObjectKey('a'.repeat(1025))).toContain('1024 characters');
  });

  it('normalizes prefixes to end with a slash', () => {
    expect(normalizePrefix('')).toBe('');
    expect(normalizePrefix('/')).toBe('');
    expect(normalizePrefix('a/b')).toBe('a/b/');
    expect(normalizePrefix('/a/b/')).toBe('a/b/');
  });
});
