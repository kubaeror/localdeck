/**
 * EC2 naming rules, in the wording the AWS console uses. The launch wizard and
 * the create modals validate against these before calling the api, so a typo
 * becomes an inline field error instead of a rejected request.
 *
 * References:
 * - Instance `Name` is a tag value: up to 256 characters, any UTF-8 except a
 *   leading `aws:`.
 * - Key pair names: up to 255 characters, alphanumeric plus `. _ -`.
 * - Security group names and descriptions: up to 255 characters, alphanumeric
 *   plus spaces and `._-:/()#,@[]+=&;{}!$*`; names cannot start with `sg-`.
 */

/** Returned by the validators when a value is acceptable. */
export type Ec2NameError = string | null;

const TAG_MAX_LENGTH = 256;
const KEY_PAIR_MAX_LENGTH = 255;
const GROUP_MAX_LENGTH = 255;

const KEY_PAIR_PATTERN = /^[A-Za-z0-9._-]+$/;
const GROUP_PATTERN = /^[A-Za-z0-9 ._\-:/()#,@[\]+=&;{}!$*]+$/;

/** The key-pair naming rules rendered as a field's constraint text. */
export const KEY_PAIR_NAME_RULES: readonly string[] = [
  `Between 1 and ${KEY_PAIR_MAX_LENGTH} characters long`,
  'Alphanumeric characters and . _ - only',
];

export const SECURITY_GROUP_NAME_RULES: readonly string[] = [
  `Between 1 and ${GROUP_MAX_LENGTH} characters long`,
  'Alphanumeric characters, spaces and . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *',
  'Cannot start with "sg-"',
];

export const SECURITY_GROUP_DESCRIPTION_RULES: readonly string[] = [
  `Between 1 and ${GROUP_MAX_LENGTH} characters long`,
  'Alphanumeric characters, spaces and . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *',
];

export const INSTANCE_NAME_RULES: readonly string[] = [
  `Between 1 and ${TAG_MAX_LENGTH} characters long`,
  "Used as the instance's Name tag",
];

/**
 * The instance name is optional (an unnamed instance shows its id), but a value
 * that is present must be a valid tag value: no empty string, no leading
 * `aws:` (reserved for AWS).
 */
export function validateInstanceName(name: string): Ec2NameError {
  if (name.length === 0) return null;
  if (name.length > TAG_MAX_LENGTH) {
    return `The instance name can be at most ${TAG_MAX_LENGTH} characters long.`;
  }
  if (name.trim().length === 0) return 'Enter at least one non-space character.';
  if (name.toLowerCase().startsWith('aws:')) {
    return 'Tag keys that start with "aws:" are reserved. Choose another name.';
  }
  return null;
}

export function validateKeyPairName(name: string): Ec2NameError {
  if (name.length === 0) return 'Enter a key pair name.';
  if (name.length > KEY_PAIR_MAX_LENGTH) {
    return `The key pair name can be at most ${KEY_PAIR_MAX_LENGTH} characters long.`;
  }
  if (!KEY_PAIR_PATTERN.test(name)) {
    return 'The key pair name can contain only alphanumeric characters and . _ -';
  }
  return null;
}

export function validateSecurityGroupName(name: string): Ec2NameError {
  if (name.length === 0) return 'Enter a security group name.';
  if (name.length > GROUP_MAX_LENGTH) {
    return `The security group name can be at most ${GROUP_MAX_LENGTH} characters long.`;
  }
  if (name.toLowerCase().startsWith('sg-')) {
    return 'The security group name cannot start with "sg-".';
  }
  if (!GROUP_PATTERN.test(name)) {
    return 'The name contains characters LocalStack does not accept. Use letters, numbers, spaces and . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *';
  }
  return null;
}

export function validateSecurityGroupDescription(description: string): Ec2NameError {
  if (description.trim().length === 0) return 'Enter a security group description.';
  if (description.length > GROUP_MAX_LENGTH) {
    return `The security group description can be at most ${GROUP_MAX_LENGTH} characters long.`;
  }
  if (!GROUP_PATTERN.test(description)) {
    return 'The description contains characters LocalStack does not accept. Use letters, numbers, spaces and . _ - : / ( ) # , @ [ ] + = & ; { } ! $ *';
  }
  return null;
}

/**
 * Device names the wizard offers when the user adds an EBS volume. The console
 * (and this wizard) allows a handful of extra volumes, so `f`–`p` is plenty.
 */
export const EXTRA_DEVICE_NAMES: readonly string[] = [
  '/dev/sdf',
  '/dev/sdg',
  '/dev/sdh',
  '/dev/sdi',
  '/dev/sdj',
  '/dev/sdk',
  '/dev/sdl',
  '/dev/sdm',
  '/dev/sdn',
  '/dev/sdo',
  '/dev/sdp',
];

/** The next free device name for a new volume, or `undefined` when full. */
export function nextDeviceName(used: readonly string[]): string | undefined {
  const taken = new Set(used);
  return EXTRA_DEVICE_NAMES.find((candidate) => !taken.has(candidate));
}
