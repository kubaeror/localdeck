import { describe, expect, it } from 'vitest';
import {
  buildIdentityPolicyText,
  buildTrustPolicyForAccount,
  buildTrustPolicyForService,
  isFullAdminPolicy,
  MANAGED_POLICY_MAX_CHARS,
  policyWarnings,
  readPolicyStatement,
  summarizeTrustedEntities,
  TRUST_POLICY_MAX_CHARS,
  validateIdentityPolicy,
  validateTrustPolicy,
} from './policy';

const VALID_IDENTITY_POLICY = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['s3:GetObject'], Resource: ['arn:aws:s3:::my-bucket/*'] },
    ],
  },
  null,
  2,
);

describe('validateIdentityPolicy', () => {
  it('accepts a well-formed document', () => {
    const result = validateIdentityPolicy(VALID_IDENTITY_POLICY);

    expect(result).toMatchObject({ jsonError: null, structureErrors: [], valid: true });
    expect(result.size).toBe(VALID_IDENTITY_POLICY.length);
    expect(result.sizeLimit).toBe(MANAGED_POLICY_MAX_CHARS);
  });

  it('rejects a document over the managed-policy size limit', () => {
    const oversized = `{"Version":"2012-10-17","Statement":[],"pad":"${'x'.repeat(MANAGED_POLICY_MAX_CHARS)}"}`;
    const result = validateIdentityPolicy(oversized);

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain(`at most ${MANAGED_POLICY_MAX_CHARS}`);
  });

  it('reports malformed JSON with the parse error', () => {
    const result = validateIdentityPolicy('{"Version":');

    expect(result.valid).toBe(false);
    expect(result.jsonError).toBeTruthy();
    expect(result.structureErrors).toEqual([]);
  });

  it('requires Version and Statement', () => {
    const result = validateIdentityPolicy(
      '{"Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}]}',
    );

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain('missing "Version"');
  });

  it('requires Statement', () => {
    const result = validateIdentityPolicy('{"Version":"2012-10-17"}');

    expect(result.structureErrors.join(' ')).toContain('missing "Statement"');
  });

  it('requires Effect, Action and Resource on every statement', () => {
    const result = validateIdentityPolicy('{"Version":"2012-10-17","Statement":[{}]}');

    expect(result.valid).toBe(false);
    expect(result.structureErrors).toEqual(
      expect.arrayContaining([
        'Statement[0] is missing "Effect".',
        'Statement[0] is missing "Action".',
        'Statement[0] is missing "Resource".',
      ]),
    );
  });

  it('rejects a bad Effect value', () => {
    const result = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"allow","Action":"s3:GetObject","Resource":"*"}]}',
    );

    expect(result.structureErrors.join(' ')).toContain('must be "Allow" or "Deny"');
  });

  it('rejects a Principal in an identity policy', () => {
    const result = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":"s3:GetObject","Resource":"*"}]}',
    );

    expect(result.structureErrors.join(' ')).toContain('must not include "Principal"');
  });

  it('rejects an empty Statement array and an empty Action array', () => {
    expect(
      validateIdentityPolicy('{"Version":"2012-10-17","Statement":[]}').structureErrors.join(' '),
    ).toContain('at least one statement');
    const emptyActions = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":[],"Resource":"*"}]}',
    );
    expect(emptyActions.valid).toBe(false);
  });

  it('treats a single statement object the same as a one-element array', () => {
    const result = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}}',
    );

    expect(result.valid).toBe(true);
  });

  it('rejects a statement with both Action and NotAction', () => {
    const result = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","NotAction":"s3:PutObject","Resource":"*"}]}',
    );

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain(
      'must not include both "Action" and "NotAction"',
    );
  });

  it('rejects a statement with both Resource and NotResource', () => {
    const result = validateIdentityPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*","NotResource":"arn:aws:s3:::b/*"}]}',
    );

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain(
      'must not include both "Resource" and "NotResource"',
    );
  });

  it('requires Version to be 2012-10-17 or 2008-10-17', () => {
    const bad = validateIdentityPolicy(
      '{"Version":"2020-01-01","Statement":{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}}',
    );
    expect(bad.valid).toBe(false);
    expect(bad.structureErrors.join(' ')).toContain(
      '"Version" must be "2012-10-17" or "2008-10-17"',
    );

    const legacy = validateIdentityPolicy(
      '{"Version":"2008-10-17","Statement":{"Effect":"Allow","Action":"s3:GetObject","Resource":"*"}}',
    );
    expect(legacy.valid).toBe(true);
  });

  it('rejects duplicate statement Sids', () => {
    const result = validateIdentityPolicy(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          { Sid: 'AllowS3', Effect: 'Allow', Action: 's3:GetObject', Resource: '*' },
          { Sid: 'AllowS3', Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' },
        ],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain('"Sid" "AllowS3" is already used');
  });

  it('accepts unique Sids', () => {
    const result = validateIdentityPolicy(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          { Sid: 'Read', Effect: 'Allow', Action: 's3:GetObject', Resource: '*' },
          { Sid: 'Delete', Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' },
        ],
      }),
    );

    expect(result.valid).toBe(true);
  });
});

describe('validateTrustPolicy', () => {
  const trust = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  });

  it('accepts a service trust policy without Resource', () => {
    expect(validateTrustPolicy(trust).valid).toBe(true);
  });

  it('requires Principal in a trust policy', () => {
    const result = validateTrustPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:AssumeRole"}]}',
    );

    expect(result.structureErrors.join(' ')).toContain('missing "Principal"');
  });

  it('accepts "*" and objects of string or string[] principals', () => {
    const wildcard = validateTrustPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"sts:AssumeRole"}]}',
    );
    expect(wildcard.valid).toBe(true);

    const object = validateTrustPolicy(
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              AWS: 'arn:aws:iam::123456789012:root',
              Service: ['lambda.amazonaws.com', 'ec2.amazonaws.com'],
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
    );
    expect(object.valid).toBe(true);
  });

  it('rejects malformed Principal shapes', () => {
    for (const principal of [
      '["arn:aws:iam::123456789012:root"]',
      '{"AWS":123}',
      '{"AWS":[]}',
      '{}',
      '42',
    ]) {
      const result = validateTrustPolicy(
        `{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":${principal},"Action":"sts:AssumeRole"}]}`,
      );
      expect(result.valid, principal).toBe(false);
      expect(result.structureErrors.join(' '), principal).toContain('"Principal" must be "*"');
    }
  });

  it('rejects a statement with both Principal and NotPrincipal', () => {
    const result = validateTrustPolicy(
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"NotPrincipal":{"AWS":"*"},"Action":"sts:AssumeRole"}]}',
    );

    expect(result.structureErrors.join(' ')).toContain(
      'must not include both "Principal" and "NotPrincipal"',
    );
  });

  it('still requires Version and Statement', () => {
    expect(validateTrustPolicy('{}').structureErrors.length).toBeGreaterThan(0);
  });

  it('enforces the trust-policy size limit', () => {
    const oversized = `{"Version":"2012-10-17","Statement":[],"pad":"${'x'.repeat(TRUST_POLICY_MAX_CHARS)}"}`;
    const result = validateTrustPolicy(oversized);

    expect(result.valid).toBe(false);
    expect(result.structureErrors.join(' ')).toContain(`at most ${TRUST_POLICY_MAX_CHARS}`);
  });
});

describe('full administrative access warnings', () => {
  it('flags Allow with Action "*" and Resource "*"', () => {
    const text = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }],
    });

    const warnings = policyWarnings(text);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('full administrative access');
    expect(isFullAdminPolicy(text)).toBe(true);
  });

  it('also flags array forms and leaves scoped or Deny statements alone', () => {
    expect(
      isFullAdminPolicy(
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: ['*'], Resource: ['*'] }],
        }),
      ),
    ).toBe(true);
    expect(
      isFullAdminPolicy(
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Deny', Action: '*', Resource: '*' }],
        }),
      ),
    ).toBe(false);
    expect(
      isFullAdminPolicy(
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: '*', Resource: 'arn:aws:s3:::bucket/*' }],
        }),
      ),
    ).toBe(false);
    expect(policyWarnings('not json')).toEqual([]);
  });
});

describe('visual editor round trip', () => {
  it('builds a document and reads it back into the same draft', () => {
    const draft = {
      effect: 'Deny' as const,
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: ['*'],
    };
    const text = buildIdentityPolicyText(draft);

    expect(validateIdentityPolicy(text).valid).toBe(true);
    expect(readPolicyStatement(text)).toEqual(draft);
  });

  it('collapses single actions and resources to strings', () => {
    const text = buildIdentityPolicyText({
      effect: 'Allow',
      actions: ['s3:GetObject'],
      resources: ['arn:aws:s3:::bucket/*'],
    });
    const parsed = JSON.parse(text) as { Statement: { Action: unknown; Resource: unknown }[] };

    expect(parsed.Statement[0]?.Action).toBe('s3:GetObject');
    expect(parsed.Statement[0]?.Resource).toBe('arn:aws:s3:::bucket/*');
  });

  it('refuses documents it cannot represent', () => {
    expect(readPolicyStatement('{"Version":"2012-10-17","Statement":[]}')).toBeNull();
    expect(
      readPolicyStatement(
        '{"Version":"2012-10-17","Statement":[{"Sid":"x","Effect":"Allow","Action":"s3:*","Resource":"*"}]}',
      ),
    ).toBeNull();
    expect(
      readPolicyStatement(
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","NotAction":"s3:*","Resource":"*"}]}',
      ),
    ).toBeNull();
    expect(
      readPolicyStatement(
        '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*","Condition":{"Bool":{"aws:SecureTransport":"false"}}}]}',
      ),
    ).toBeNull();
  });
});

describe('trust policy helpers', () => {
  it('builds a service trust policy', () => {
    const text = buildTrustPolicyForService(['lambda.amazonaws.com']);
    const parsed = JSON.parse(text) as {
      Statement: { Principal: { Service: unknown }; Action: string }[];
    };

    expect(validateTrustPolicy(text).valid).toBe(true);
    expect(parsed.Statement[0]?.Principal.Service).toBe('lambda.amazonaws.com');
    expect(parsed.Statement[0]?.Action).toBe('sts:AssumeRole');
    expect(
      JSON.parse(buildTrustPolicyForService(['a.amazonaws.com', 'b.amazonaws.com'])),
    ).toMatchObject({
      Statement: [{ Principal: { Service: ['a.amazonaws.com', 'b.amazonaws.com'] } }],
    });
  });

  it('builds an account trust policy', () => {
    const text = buildTrustPolicyForAccount('123456789012');

    expect(validateTrustPolicy(text).valid).toBe(true);
    expect(text).toContain('arn:aws:iam::123456789012:root');
  });

  it('summarizes the trusted entities of a role', () => {
    expect(summarizeTrustedEntities(buildTrustPolicyForService(['lambda.amazonaws.com']))).toBe(
      'lambda.amazonaws.com',
    );
    expect(summarizeTrustedEntities(buildTrustPolicyForAccount('123456789012'))).toBe(
      'account 123456789012',
    );
    expect(
      summarizeTrustedEntities(
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: ['a.amazonaws.com', 'b.amazonaws.com', 'c.amazonaws.com'],
              },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
      ),
    ).toBe('a.amazonaws.com and 2 more');
    expect(summarizeTrustedEntities(undefined)).toBe('—');
    expect(summarizeTrustedEntities('not json')).toBe('unknown');
  });
});
