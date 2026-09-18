import type { ApiError } from '@localdeck/shared';
import { ApiClientError, toApiError } from '../../lib/apiClient';

/**
 * Turns the api's `ApiError` codes into console wording, and decides whether a
 * failure belongs on a form field (the launch wizard's AMI or key pair) or in
 * a flashbar/alert.
 */

/** Form fields the EC2 module can attach a message to. */
export type Ec2ErrorField =
  | 'name'
  | 'imageId'
  | 'instanceType'
  | 'keyName'
  | 'network'
  | 'securityGroups'
  | 'storage'
  | 'groupName'
  | 'volumeSize'
  | null;

export interface FriendlyEc2Error {
  /** Field the message belongs to; `null` for page-level failures. */
  field: Ec2ErrorField;
  /** Safe-to-render console wording. */
  message: string;
  /** The original contract, for retry logic and code checks. */
  apiError: ApiError;
}

const FRIENDLY: Readonly<Record<string, { field: Ec2ErrorField; message: string }>> = {
  'InvalidAMIID.NotFound': {
    field: 'imageId',
    message:
      'LocalStack does not have this AMI. Pick another image; the wizard lists the images the running emulator offers.',
  },
  InvalidAMIID: {
    field: 'imageId',
    message: 'LocalStack rejected the AMI id. Pick an image from the list.',
  },
  InvalidAMIIDMalformed: {
    field: 'imageId',
    message: 'The AMI id is malformed. Pick an image from the list.',
  },
  'InvalidInstanceID.NotFound': {
    field: null,
    message:
      'This instance no longer exists in LocalStack. It may have been terminated outside LocalDeck — refresh the list.',
  },
  InvalidInstanceID: {
    field: null,
    message: 'LocalStack rejected the instance id. Refresh the list and try again.',
  },
  IncorrectInstanceState: {
    field: null,
    message:
      'The instance is not in a state that allows this action. Refresh the list: for example, only a stopped instance can be started and only a running one can be stopped.',
  },
  IncorrectState: {
    field: null,
    message:
      'The resource is not in a state that allows this action. Refresh the page and check its current status.',
  },
  InvalidParameterValue: {
    field: null,
    message: 'LocalStack rejected one of the request values.',
  },
  MissingParameter: {
    field: null,
    message:
      'LocalStack rejected the request because a parameter was missing. This usually means the running LocalStack version and the AWS SDK model disagree about a field name — check the api logs for the exact parameter.',
  },
  InvalidGroupNotFound: {
    field: 'securityGroups',
    message:
      'A selected security group no longer exists in LocalStack. Refresh the list and select the groups again.',
  },
  'InvalidGroup.NotFound': {
    field: 'securityGroups',
    message:
      'A selected security group no longer exists in LocalStack. Refresh the list and select the groups again.',
  },
  'InvalidGroup.Duplicate': {
    field: 'groupName',
    message:
      'A security group with this name already exists in the selected VPC. Choose another name.',
  },
  InvalidGroupReserved: {
    field: 'groupName',
    message: 'This security group name is reserved. Choose another name.',
  },
  DependencyViolation: {
    field: null,
    message:
      'LocalStack refused the deletion because another resource still depends on this one (for a security group: an attached instance or network interface; for a volume: an attachment). Remove the dependency and try again.',
  },
  VolumeInUse: {
    field: null,
    message:
      'The volume is still attached to an instance. Terminate the instance (or detach the volume where the emulator supports it) and try again.',
  },
  'InvalidVolume.NotFound': {
    field: null,
    message: 'This volume no longer exists in LocalStack. Refresh the list.',
  },
  'InvalidVolume.ZoneMismatch': {
    field: null,
    message:
      'The volume and the instance are in different Availability Zones. Attach a volume from the instance zone, or create one there first.',
  },
  'InvalidPermission.NotFound': {
    field: null,
    message:
      'That rule is no longer on the security group. Refresh the page and check the current rules.',
  },
  'InvalidPermission.Duplicate': {
    field: 'securityGroups',
    message:
      'An identical rule already exists on this security group. Edit the existing rule instead of adding a duplicate.',
  },
  RulesPerSecurityGroupLimitExceeded: {
    field: null,
    message: 'This security group has reached the rule limit. Revoke a rule before adding another.',
  },
  InvalidParameterCombination: {
    field: null,
    message:
      'LocalStack rejected this combination of parameters. Check the values that belong together, for example a provisioned IOPS value with a volume type that supports it.',
  },
  'InvalidSnapshot.NotFound': {
    field: 'volumeSize',
    message:
      'LocalStack does not have this snapshot. Check the snapshot id, or create the volume without one.',
  },
  'InvalidKeyPair.NotFound': {
    field: 'keyName',
    message:
      'The selected key pair no longer exists in LocalStack. Refresh the wizard and choose again, or proceed without a key pair.',
  },
  'InvalidKeyPair.Duplicate': {
    field: 'keyName',
    message: 'A key pair with this name already exists in LocalStack. Choose another name.',
  },
  'InvalidSubnetID.NotFound': {
    field: 'network',
    message: 'The selected subnet no longer exists in LocalStack. Refresh the network step.',
  },
  'InvalidVpcID.NotFound': {
    field: 'network',
    message: 'The selected VPC no longer exists in LocalStack. Refresh the network step.',
  },
  InstanceLimitExceeded: {
    field: null,
    message:
      'The LocalStack account has reached its EC2 instance limit. Terminate unused instances and try again.',
  },
  InsufficientInstanceCapacity: {
    field: 'instanceType',
    message: 'LocalStack has no capacity for this instance type. Choose another type.',
  },
  InvalidBlockDeviceMapping: {
    field: 'storage',
    message:
      'LocalStack rejected the storage configuration. Check the device names, sizes and types.',
  },
  InvalidDeviceName: {
    field: 'storage',
    message: 'The device name is not valid. Use names like /dev/sdf and /dev/sdg.',
  },
  UnauthorizedOperation: {
    field: null,
    message:
      'LocalStack denied this action. Check the credentials LocalDeck is configured with and the resource policies.',
  },
  UnsupportedOperation: {
    field: null,
    message:
      'The running LocalStack build does not support this operation for this resource. LocalDeck disables actions it knows are unsupported — this one failed upstream.',
  },
  Unsupported: {
    field: null,
    message:
      'The running LocalStack build does not support this operation for this resource, so LocalDeck cannot complete it.',
  },
  OperationNotPermitted: {
    field: null,
    message: 'LocalStack does not permit this operation for the resource in its current state.',
  },
  InternalError: {
    field: null,
    message:
      'LocalStack reported an internal error for this operation. That is a limitation of the running emulator, not of LocalDeck; the api logs contain the upstream details.',
  },
  RequestLimitExceeded: {
    field: null,
    message: 'Too many requests were sent to LocalStack. Wait a moment and try again.',
  },
  Throttling: {
    field: null,
    message: 'LocalStack throttled the request. Wait a moment and try again.',
  },
};

/**
 * The SDK mirrors AWS error shapes with an `Exception` suffix
 * (`NoSuchEntityException`), while the models use several spellings for dotted
 * codes (`InvalidGroup.NotFound` arrives flattened as `InvalidGroupNotFound`).
 * Normalizing to alphanumerics makes every spelling resolve to the same entry.
 */
function canonicalCode(code: string): string {
  const withoutSuffix = code.endsWith('Exception') ? code.slice(0, -'Exception'.length) : code;
  return withoutSuffix.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const FRIENDLY_BY_CANONICAL: ReadonlyMap<string, { field: Ec2ErrorField; message: string }> =
  new Map(Object.entries(FRIENDLY).map(([code, entry]) => [canonicalCode(code), entry]));

function lookup(code: string): { field: Ec2ErrorField; message: string } | undefined {
  return FRIENDLY[code] ?? FRIENDLY_BY_CANONICAL.get(canonicalCode(code));
}

/**
 * Maps one api error to console wording. `fieldHint` names the form field the
 * caller knows the failure came from, so the launch wizard can show the message
 * next to the input that needs attention.
 */
export function friendlyEc2Error(
  apiError: ApiError,
  fieldHint: Ec2ErrorField = null,
): FriendlyEc2Error {
  const known = lookup(apiError.code);
  if (known !== undefined) {
    return { ...known, field: known.field ?? fieldHint, apiError };
  }
  return { field: fieldHint, message: apiError.message, apiError };
}

/** Same as {@link friendlyEc2Error}, for a value caught in a try/catch. */
export function toFriendlyEc2Error(
  caught: unknown,
  fieldHint: Ec2ErrorField = null,
): FriendlyEc2Error {
  return friendlyEc2Error(toApiError(caught), fieldHint);
}

/** True when the failure is one of the named EC2 error codes. */
export function isEc2Code(caught: unknown, ...codes: readonly string[]): boolean {
  if (!(caught instanceof ApiClientError)) return false;
  const code = canonicalCode(caught.apiError.code);
  return codes.some((candidate) => canonicalCode(candidate) === code);
}
