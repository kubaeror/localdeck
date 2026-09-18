import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/apiClient';
import {
  annotateS3Error,
  createdAnnotation,
  friendlyS3Error,
  isS3Code,
  toFriendlyS3Error,
} from './errors';

describe('friendlyS3Error', () => {
  it('maps a name collision to an inline bucket-name error', () => {
    const friendly = friendlyS3Error({
      code: 'BucketAlreadyExists',
      message: 'The requested bucket name is not available.',
      statusCode: 400,
    });

    expect(friendly.field).toBe('bucketName');
    expect(friendly.message).toContain('already in use');
  });

  it('maps BucketAlreadyOwnedByYou to the same field', () => {
    expect(
      friendlyS3Error({ code: 'BucketAlreadyOwnedByYou', message: '', statusCode: 409 }).field,
    ).toBe('bucketName');
  });

  it('keeps page-level failures off the form fields', () => {
    const friendly = friendlyS3Error({
      code: 'BucketNotEmpty',
      message: 'The bucket you tried to delete is not empty',
      statusCode: 409,
    });
    expect(friendly.field).toBeNull();
    expect(friendly.message).toContain('not empty');
    expect(friendly.apiError.code).toBe('BucketNotEmpty');

    const unknown = friendlyS3Error({
      code: 'SomethingNew',
      message: 'LocalStack said no.',
      statusCode: 500,
    });
    expect(unknown.field).toBeNull();
    expect(unknown.message).toBe('LocalStack said no.');
  });
});

describe('toFriendlyS3Error and isS3Code', () => {
  it('reads the api error contract out of an ApiClientError', () => {
    const error = new ApiClientError({
      code: 'NoSuchTagSet',
      message: 'The TagSet does not exist',
      statusCode: 404,
    });

    expect(isS3Code(error, 'NoSuchTagSet')).toBe(true);
    expect(isS3Code(error, 'NoSuchBucket')).toBe(false);
    expect(isS3Code(new Error('plain'), 'NoSuchTagSet')).toBe(false);
    expect(toFriendlyS3Error(error).message).toContain('TagSet');
  });

  it('keeps the "bucket was created" annotation in the friendly message', () => {
    const annotated = annotateS3Error(
      new ApiClientError({ code: 'AccessDenied', message: 'Access Denied', statusCode: 403 }),
      'Bucket "my-bucket" was created, but tagging failed.',
    );

    const friendly = toFriendlyS3Error(annotated);
    expect(createdAnnotation(friendly.apiError)).toBe(
      'Bucket "my-bucket" was created, but tagging failed.',
    );
    expect(friendly.message).toContain('Bucket "my-bucket" was created, but tagging failed.');
    // The canned wording for the code is still appended.
    expect(friendly.message).toContain('LocalStack denied this action');
  });
});
