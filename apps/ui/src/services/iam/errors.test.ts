import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/apiClient';
import {
  friendlyIamError,
  isIamCode,
  POLICY_VERSION_LIMIT_MESSAGE,
  toFriendlyIamError,
} from './errors';

describe('friendlyIamError', () => {
  it('maps an already-existing resource to console wording', () => {
    const friendly = friendlyIamError({
      code: 'EntityAlreadyExistsException',
      message: 'User with name alice already exists.',
      statusCode: 409,
    });

    expect(friendly.field).toBeNull();
    expect(friendly.message).toContain('already exists');
    expect(friendly.apiError.code).toBe('EntityAlreadyExistsException');
  });

  it('keeps the field hint for name failures', () => {
    const friendly = friendlyIamError(
      { code: 'EntityAlreadyExists', message: 'exists', statusCode: 409 },
      'userName',
    );

    expect(friendly.field).toBe('userName');
  });

  it('maps a rejected policy document to the policy field', () => {
    const friendly = friendlyIamError({
      code: 'MalformedPolicyDocumentException',
      message: 'Syntax errors in policy.',
      statusCode: 400,
    });

    expect(friendly.field).toBe('policyDocument');
    expect(friendly.message).toContain('structure checks');
  });

  it('keeps unknown codes page-level with the api message', () => {
    const friendly = friendlyIamError({
      code: 'SomethingNew',
      message: 'LocalStack said no.',
      statusCode: 500,
    });

    expect(friendly.field).toBeNull();
    expect(friendly.message).toBe('LocalStack said no.');
  });
});

describe('toFriendlyIamError and isIamCode', () => {
  it('matches error codes with and without the Exception suffix', () => {
    const error = new ApiClientError({
      code: 'DeleteConflictException',
      message: 'Cannot delete entity, must delete access keys first.',
      statusCode: 409,
    });

    expect(isIamCode(error, 'DeleteConflict')).toBe(true);
    expect(isIamCode(error, 'DeleteConflictException')).toBe(true);
    expect(isIamCode(error, 'NoSuchEntity')).toBe(false);
    expect(isIamCode(new Error('plain'), 'DeleteConflict')).toBe(false);
    expect(toFriendlyIamError(error).message).toContain('refused the deletion');
  });

  it('explains the five-version limit with a recovery path', () => {
    expect(POLICY_VERSION_LIMIT_MESSAGE).toContain('five versions');
    expect(POLICY_VERSION_LIMIT_MESSAGE).toContain('Versions tab');
    expect(POLICY_VERSION_LIMIT_MESSAGE).toContain('delete-policy-version');
  });
});
