import { describe, expect, it } from 'vitest';
import { buildExampleBucketPolicy, validateBucketPolicy } from './policy';

const VALID = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'AllowList',
      Effect: 'Allow',
      Principal: { AWS: 'arn:aws:iam::000000000000:root' },
      Action: ['s3:ListBucket'],
      Resource: ['arn:aws:s3:::my-bucket'],
    },
  ],
});

describe('validateBucketPolicy', () => {
  it('accepts an IAM policy document', () => {
    const result = validateBucketPolicy(VALID);
    expect(result.jsonError).toBeNull();
    expect(result.structureErrors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.grantsPublicAccess).toBe(false);
  });

  it('accepts a single statement object instead of an array', () => {
    const result = validateBucketPolicy(
      '{"Statement":{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*"}}',
    );
    expect(result.valid).toBe(true);
  });

  it('reports malformed JSON and skips the structural checks', () => {
    const result = validateBucketPolicy('{"Statement": [');
    expect(result.jsonError).not.toBeNull();
    expect(result.structureErrors).toEqual([]);
    expect(result.valid).toBe(false);
  });

  it('requires a JSON object', () => {
    const result = validateBucketPolicy('[1,2,3]');
    expect(result.jsonError).toBeNull();
    expect(result.structureErrors).toEqual(['The policy document must be a JSON object.']);
  });

  it('requires Statement, Effect, Principal, Action and Resource', () => {
    const result = validateBucketPolicy('{"Version":"2012-10-17","Statement":[{}]}');

    expect(result.valid).toBe(false);
    expect(result.structureErrors).toContain('Statement[0] is missing "Effect".');
    expect(result.structureErrors).toContain(
      'Statement[0] is missing "Principal" (bucket policies must name a principal).',
    );
    expect(result.structureErrors).toContain('Statement[0] is missing "Action".');
    expect(result.structureErrors).toContain('Statement[0] is missing "Resource".');
  });

  it('rejects an invalid effect and a non-object statement', () => {
    const result = validateBucketPolicy(
      '{"Statement":[{"Effect":"Maybe","Principal":"*","Action":"s3:GetObject","Resource":"*"},"nope"]}',
    );
    expect(result.structureErrors).toContain('Statement[0] "Effect" must be "Allow" or "Deny".');
    expect(result.structureErrors).toContain('Statement[1] must be a JSON object.');
  });

  it('flags wildcard principals with an Allow effect as public', () => {
    expect(validateBucketPolicy(buildExampleBucketPolicy('my-bucket')).grantsPublicAccess).toBe(
      true,
    );

    const denyOnly = validateBucketPolicy(
      '{"Statement":{"Effect":"Deny","Principal":"*","Action":"s3:*","Resource":"arn:aws:s3:::b/*"}}',
    );
    expect(denyOnly.grantsPublicAccess).toBe(false);
  });

  it('finds a wildcard nested inside an object or array Principal', () => {
    const statement = (principal: unknown): string =>
      JSON.stringify({
        Statement: {
          Effect: 'Allow',
          Principal: principal,
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::b/*',
        },
      });

    expect(validateBucketPolicy(statement({ AWS: '*' })).grantsPublicAccess).toBe(true);
    expect(validateBucketPolicy(statement({ AWS: ['*'] })).grantsPublicAccess).toBe(true);
    expect(validateBucketPolicy(statement(['*'])).grantsPublicAccess).toBe(true);
    // A named principal map is not public, whatever its shape.
    expect(
      validateBucketPolicy(statement({ AWS: 'arn:aws:iam::000000000000:root' })).grantsPublicAccess,
    ).toBe(false);
    expect(
      validateBucketPolicy(statement({ Service: 'cloudfront.amazonaws.com' })).grantsPublicAccess,
    ).toBe(false);
  });

  it('builds the example policy from the current bucket name', () => {
    const policy = buildExampleBucketPolicy('alpha-bucket');
    expect(policy).toContain('arn:aws:s3:::alpha-bucket/*');
    expect(policy).not.toContain('my-bucket');
    expect(validateBucketPolicy(policy)).toMatchObject({
      valid: true,
      grantsPublicAccess: true,
    });
  });

  it('rejects an empty statement list', () => {
    const result = validateBucketPolicy('{"Statement":[]}');
    expect(result.structureErrors).toContain('"Statement" must contain at least one statement.');
  });

  it('validates Version and Sid types', () => {
    const result = validateBucketPolicy(
      '{"Version":2012,"Statement":{"Sid":1,"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"*"}}',
    );
    expect(result.structureErrors).toContain(
      '"Version" must be a string, for example "2012-10-17".',
    );
    expect(result.structureErrors).toContain('Statement[0] "Sid" must be a string.');
  });
});
