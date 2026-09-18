import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/apiClient';
import { friendlyEksError, toFriendlyEksError } from './errors';

describe('EKS error mapping', () => {
  it('maps AWS EKS codes to console wording with a field hint', () => {
    const notFound = friendlyEksError({
      code: 'ResourceNotFoundException',
      message: 'No cluster found',
      statusCode: 404,
      service: 'eks',
    });
    expect(notFound.message).toContain('deleted outside LocalDeck');
    expect(notFound.field).toBeNull();

    const conflict = friendlyEksError({
      code: 'ConflictException',
      message: 'already exists',
      statusCode: 409,
    });
    expect(conflict.field).toBe('name');

    const invalid = friendlyEksError(
      {
        code: 'InvalidParameterException',
        message: 'bad',
        statusCode: 400,
      },
      'scaling',
    );
    expect(invalid.field).toBe('scaling');
  });

  it('keeps LocalDeck codes (kubeconfig before ACTIVE) actionable', () => {
    const friendly = friendlyEksError({
      code: 'CLUSTER_NOT_READY',
      message: 'cluster is CREATING',
      statusCode: 409,
    });
    expect(friendly.message).toContain('ACTIVE');
    expect(friendly.message).not.toContain('stack');
  });

  it('matches dotted and suffixed spellings through canonicalisation', () => {
    const friendly = friendlyEksError({
      code: 'ResourceNotFoundException',
      message: 'gone',
      statusCode: 404,
    });
    expect(friendly.message).toContain('does not have a cluster');
  });

  it('falls back to the api message for unknown codes', () => {
    const friendly = toFriendlyEksError(
      new ApiClientError({
        code: 'SOMETHING_NEW',
        message: 'LocalStack said no.',
        statusCode: 400,
      }),
      'version',
    );
    expect(friendly.message).toBe('LocalStack said no.');
    expect(friendly.field).toBe('version');
  });
});
