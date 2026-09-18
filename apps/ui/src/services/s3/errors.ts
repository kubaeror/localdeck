import type { ApiError } from '@localdeck/shared';
import { ApiClientError, toApiError } from '../../lib/apiClient';

/**
 * Turns the api's `ApiError` codes into console wording, and decides whether a
 * failure belongs on a form field (the create wizard's bucket name) or in a
 * flashbar/alert.
 */

/** Form fields the S3 module can attach a message to. */
export type S3ErrorField = 'bucketName' | 'objectKey' | 'policy';

export interface FriendlyS3Error {
  /** Field the message belongs to; `null` for page-level failures. */
  field: S3ErrorField | null;
  /** Safe-to-render console wording. */
  message: string;
  /** The original contract, for retry logic and code checks. */
  apiError: ApiError;
}

const FRIENDLY: Readonly<Record<string, { field: S3ErrorField | null; message: string }>> = {
  BucketAlreadyExists: {
    field: 'bucketName',
    message:
      'This bucket name is already in use. Bucket names must be unique across all accounts and regions, so choose a different name.',
  },
  BucketAlreadyOwnedByYou: {
    field: 'bucketName',
    message:
      'You already own a bucket with this name. Delete it first, or choose a different name.',
  },
  InvalidBucketName: {
    field: 'bucketName',
    message: 'LocalStack rejected this bucket name. Check the naming rules below and try again.',
  },
  NoSuchBucket: {
    field: null,
    message:
      'This bucket no longer exists. It may have been deleted outside LocalDeck — refresh the bucket list.',
  },
  BucketNotEmpty: {
    field: null,
    message:
      'This bucket is not empty. Delete every object and object version first, then delete the bucket.',
  },
  NoSuchKey: {
    field: null,
    message: 'This object no longer exists. Refresh the folder to see the current contents.',
  },
  NoSuchVersion: {
    field: null,
    message: 'That object version does not exist. Refresh the folder and try again.',
  },
  AccessDenied: {
    field: null,
    message:
      'LocalStack denied this action. Check the bucket policy and Block Public Access settings.',
  },
  MalformedPolicy: {
    field: 'policy',
    message:
      'LocalStack rejected the bucket policy. Compare it with the IAM policy structure checks below.',
  },
  InvalidPolicyDocument: {
    field: 'policy',
    message: 'LocalStack rejected the bucket policy document. Check the statement structure.',
  },
  InvalidArgument: {
    field: null,
    message: 'LocalStack rejected one of the request arguments. Check the values and try again.',
  },
};

/**
 * Extracts the "Bucket … was created, but … failed." sentence that
 * {@link annotateS3Error} prepends, when one is present.
 */
export function createdAnnotation(apiError: ApiError): string | undefined {
  const match = /^(Bucket ".*?" was created, but .*? failed\.)\s+/.exec(apiError.message);
  return match?.[1];
}

/** Maps one api error to console wording and, when relevant, a form field. */
export function friendlyS3Error(apiError: ApiError): FriendlyS3Error {
  const known = FRIENDLY[apiError.code];
  const annotation = createdAnnotation(apiError);
  if (known !== undefined) {
    return {
      ...known,
      // A post-create failure is really two facts: the bucket exists, and the
      // follow-up step failed. Never let the canned wording hide the first.
      message: annotation === undefined ? known.message : `${annotation} ${known.message}`,
      apiError,
    };
  }
  return { field: null, message: apiError.message, apiError };
}

/** Same as {@link friendlyS3Error}, for a value caught in a try/catch. */
export function toFriendlyS3Error(caught: unknown): FriendlyS3Error {
  return friendlyS3Error(toApiError(caught));
}

/** True when the failure is one of the named S3 error codes. */
export function isS3Code(caught: unknown, ...codes: readonly string[]): boolean {
  if (!(caught instanceof ApiClientError)) return false;
  return codes.includes(caught.apiError.code);
}

/** Annotates a failure that happened after an earlier step already succeeded. */
export function annotateS3Error(caught: unknown, context: string): ApiClientError {
  const apiError = toApiError(caught);
  return new ApiClientError({ ...apiError, message: `${context} ${apiError.message}` });
}
