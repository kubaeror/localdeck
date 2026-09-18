import type { ApiError } from '@localdeck/shared';
import { ApiClientError, toApiError } from '../../lib/apiClient';

/**
 * Turns the api's `ApiError` codes into console wording, and decides whether a
 * failure belongs on a form field (a name that already exists, a rejected
 * policy document) or in a flashbar/alert.
 */

/** Form fields the IAM module can attach a message to. */
export type IamErrorField =
  'userName' | 'groupName' | 'roleName' | 'policyName' | 'policyDocument' | 'trustPolicy' | null;

export interface FriendlyIamError {
  /** Field the message belongs to; `null` for page-level failures. */
  field: IamErrorField;
  /** Safe-to-render console wording. */
  message: string;
  /** The original contract, for retry logic and code checks. */
  apiError: ApiError;
}

const FRIENDLY: Readonly<Record<string, { field: IamErrorField; message: string }>> = {
  EntityAlreadyExists: {
    field: null,
    message:
      'A resource with this name already exists in this LocalStack account. Choose a different name.',
  },
  NoSuchEntity: {
    field: null,
    message:
      'This resource no longer exists. It may have been deleted outside LocalDeck — refresh the list.',
  },
  DeleteConflict: {
    field: null,
    message:
      'LocalStack refused the deletion. Remove everything the resource still references (for a user: access keys and group memberships; for a role or group: attached policies; for a policy: attached entities) and try again.',
  },
  MalformedPolicyDocument: {
    field: 'policyDocument',
    message:
      'LocalStack rejected the policy document. Compare it with the structure checks in the editor.',
  },
  LimitExceeded: {
    field: null,
    message:
      'The LocalStack account has reached an IAM limit for this operation. Delete unused resources and try again.',
  },
  ReportGenerationLimitExceeded: {
    field: null,
    message: 'Too many requests of this kind were made. Wait a moment and try again.',
  },
  AccessDenied: {
    field: null,
    message:
      'LocalStack denied this action. Check the credentials LocalDeck is configured with and the resource policies.',
  },
  ValidationError: {
    field: null,
    message: 'LocalStack rejected one of the request values.',
  },
  InvalidInput: {
    field: null,
    message: 'LocalStack rejected one of the request values.',
  },
};

/**
 * The SDK mirrors AWS error shapes with an `Exception` suffix
 * (`NoSuchEntityException`), while the console wording and the older service
 * models use the bare name. Both spellings resolve to the same entry.
 */
function canonicalCode(code: string): string {
  return code.endsWith('Exception') ? code.slice(0, -'Exception'.length) : code;
}

/**
 * Maps one api error to console wording. `fieldHint` names the form field the
 * caller knows the failure came from (an already-existing user name), which is
 * how the create wizards place the message next to the input.
 */
export function friendlyIamError(
  apiError: ApiError,
  fieldHint: IamErrorField = null,
): FriendlyIamError {
  const known = FRIENDLY[apiError.code] ?? FRIENDLY[canonicalCode(apiError.code)];
  if (known !== undefined) {
    return { ...known, field: known.field ?? fieldHint, apiError };
  }
  return { field: fieldHint, message: apiError.message, apiError };
}

/** Same as {@link friendlyIamError}, for a value caught in a try/catch. */
export function toFriendlyIamError(
  caught: unknown,
  fieldHint: IamErrorField = null,
): FriendlyIamError {
  return friendlyIamError(toApiError(caught), fieldHint);
}

/** True when the failure is one of the named IAM error codes. */
export function isIamCode(caught: unknown, ...codes: readonly string[]): boolean {
  if (!(caught instanceof ApiClientError)) return false;
  const code = canonicalCode(caught.apiError.code);
  return codes.some((candidate) => canonicalCode(candidate) === code);
}

/** Annotates a failure that happened after an earlier step already succeeded. */
export function annotateIamError(caught: unknown, context: string): ApiClientError {
  const apiError = toApiError(caught);
  return new ApiClientError({ ...apiError, message: `${context} ${apiError.message}` });
}
