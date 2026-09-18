/**
 * IAM resource naming rules, in the wording the AWS console uses. The create
 * wizards validate against these before calling the api, so a typo becomes an
 * inline field error instead of a rejected request.
 *
 * Reference: IAM names are 1–64 characters for users and roles, 1–128 for
 * groups and policies. All of them accept the same character set: alphanumeric
 * characters plus `+=,.@_-`.
 */

const NAME_PATTERN = /^[\w+=,.@-]+$/;

const USER_MAX_LENGTH = 64;
const GROUP_MAX_LENGTH = 128;
const ROLE_MAX_LENGTH = 64;
const POLICY_MAX_LENGTH = 128;

/** Returned by the validators when a name is acceptable. */
export type IamNameError = string | null;

/** The naming rules rendered as a field's constraint text. */
export function iamNameRules(maxLength: number): readonly string[] {
  return [`Between 1 and ${maxLength} characters long`, 'Alphanumeric characters and +=,.@_- only'];
}

function validate(name: string, noun: string, maxLength: number): IamNameError {
  const label = `${noun} name`;
  if (name.length === 0) return `Enter a ${noun.toLowerCase()} name.`;
  if (name.length > maxLength) {
    return `${label} can be at most ${maxLength} characters long.`;
  }
  if (!NAME_PATTERN.test(name)) {
    return `${label} can contain only alphanumeric characters and +=,.@_-`;
  }
  return null;
}

export function validateUserName(name: string): IamNameError {
  return validate(name, 'User', USER_MAX_LENGTH);
}

export function validateGroupName(name: string): IamNameError {
  return validate(name, 'Group', GROUP_MAX_LENGTH);
}

export function validateRoleName(name: string): IamNameError {
  return validate(name, 'Role', ROLE_MAX_LENGTH);
}

export function validatePolicyName(name: string): IamNameError {
  return validate(name, 'Policy', POLICY_MAX_LENGTH);
}

export const IAM_USER_NAME_RULES = iamNameRules(USER_MAX_LENGTH);
export const IAM_GROUP_NAME_RULES = iamNameRules(GROUP_MAX_LENGTH);
export const IAM_ROLE_NAME_RULES = iamNameRules(ROLE_MAX_LENGTH);
export const IAM_POLICY_NAME_RULES = iamNameRules(POLICY_MAX_LENGTH);
