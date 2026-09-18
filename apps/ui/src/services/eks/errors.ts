import type { ApiError } from '@localdeck/shared';
import { toApiError } from '../../lib/apiClient';

/**
 * Turns the api's `ApiError` values into console wording for EKS, and points
 * each failure at the wizard or modal field that should show it.
 */

/** Fields the EKS module can attach a message to; `null` means page level. */
export type EksErrorField =
  | 'name'
  | 'version'
  | 'roleArn'
  | 'network'
  | 'endpointAccess'
  | 'nodegroupName'
  | 'nodeRole'
  | 'instanceTypes'
  | 'scaling'
  | 'tags'
  | null;

export interface FriendlyEksError {
  field: EksErrorField;
  message: string;
  apiError: ApiError;
}

const FRIENDLY: Readonly<Record<string, { field: EksErrorField; message: string }>> = {
  ResourceNotFoundException: {
    field: null,
    message:
      'LocalStack does not have a cluster or node group with that name. It may have been deleted outside LocalDeck — refresh the page.',
  },
  InvalidParameterException: {
    field: null,
    message:
      'LocalStack rejected one of the request parameters. Check the cluster name, Kubernetes version, IAM role and networking selections.',
  },
  InvalidRequestException: {
    field: null,
    message:
      'LocalStack rejected the request as invalid. Review the values in the form — for example, a node group must use the same Kubernetes version as its cluster.',
  },
  ConflictException: {
    field: 'name',
    message: 'A resource with this name already exists, or is still being created or deleted.',
  },
  ClientException: {
    field: null,
    message: 'LocalStack rejected the request, usually because the cluster is not ready for it.',
  },
  ServerException: {
    field: null,
    message:
      'LocalStack reported a server-side EKS failure. This is a limitation of the running emulator, not of LocalDeck; the api logs contain the upstream details.',
  },
  UnsupportedAvailabilityZoneException: {
    field: 'network',
    message:
      'The selected subnets do not cover the availability zones LocalStack supports for EKS.',
  },
  BadRequestException: {
    field: null,
    message: 'LocalStack rejected the request as malformed.',
  },
  AccessDeniedException: {
    field: null,
    message: 'LocalStack denied this action. Check the credentials LocalDeck is configured with.',
  },
  ThrottlingException: {
    field: null,
    message: 'LocalStack throttled the request. Wait a moment and try again.',
  },
  ServiceUnavailableException: {
    field: null,
    message: 'The LocalStack EKS service is temporarily unavailable. Wait a moment and try again.',
  },
  /** LocalDeck's own code for a kubeconfig requested too early. */
  CLUSTER_NOT_READY: {
    field: null,
    message:
      'The kubeconfig can only be downloaded once the cluster is ACTIVE. LocalDeck keeps polling while the cluster is being created.',
  },
  LOCALSTACK_UNREACHABLE: {
    field: null,
    message:
      'LocalDeck cannot reach LocalStack right now. The console stopped sending EKS calls; retry when LocalStack is reachable again.',
  },
};

/** Removes the `Exception` suffix and punctuation, so codes match loosely. */
function canonicalCode(code: string): string {
  const withoutSuffix = code.endsWith('Exception') ? code.slice(0, -'Exception'.length) : code;
  return withoutSuffix.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const FRIENDLY_BY_CANONICAL: ReadonlyMap<string, { field: EksErrorField; message: string }> =
  new Map(Object.entries(FRIENDLY).map(([code, entry]) => [canonicalCode(code), entry]));

function lookup(code: string): { field: EksErrorField; message: string } | undefined {
  return FRIENDLY[code] ?? FRIENDLY_BY_CANONICAL.get(canonicalCode(code));
}

/**
 * Maps one api error to EKS console wording. `fieldHint` is the form field the
 * caller knows the request came from, used when the code alone is ambiguous.
 */
export function friendlyEksError(
  apiError: ApiError,
  fieldHint: EksErrorField = null,
): FriendlyEksError {
  const known = lookup(apiError.code);
  if (known !== undefined) return { ...known, field: known.field ?? fieldHint, apiError };
  return { field: fieldHint, message: apiError.message, apiError };
}

/** Same as {@link friendlyEksError}, for a value caught in a try/catch. */
export function toFriendlyEksError(
  caught: unknown,
  fieldHint: EksErrorField = null,
): FriendlyEksError {
  return friendlyEksError(toApiError(caught), fieldHint);
}
