/**
 * EKS naming and scaling rules, in one place so the create wizard, the
 * nodegroup modals and their tests agree with the API.
 */

/** EKS cluster names: 1–100 characters of alphanumerics, `-` and `_`. */
export const CLUSTER_NAME_PATTERN = /^[0-9A-Za-z][A-Za-z0-9-_]*$/;
export const CLUSTER_NAME_RULES: readonly string[] = [
  '1 to 100 characters',
  'Letters, numbers, hyphens and underscores',
  'Starts with a letter or number',
];

/** Managed node group names: 1–63 characters of alphanumerics, `-` and `_`. */
export const NODEGROUP_NAME_PATTERN = /^[0-9A-Za-z][A-Za-z0-9-_]{0,62}$/;
export const NODEGROUP_NAME_RULES: readonly string[] = [
  '1 to 63 characters',
  'Letters, numbers, hyphens and underscores',
  'Starts with a letter or number',
];

export function validateClusterName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return 'Enter a cluster name.';
  if (name.length > 100) return 'Cluster names are at most 100 characters long.';
  if (!CLUSTER_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, hyphens and underscores, starting with a letter or number.';
  }
  return null;
}

export function validateNodegroupName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return 'Enter a node group name.';
  if (name.length > 63) return 'Node group names are at most 63 characters long.';
  if (!NODEGROUP_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, hyphens and underscores, starting with a letter or number.';
  }
  return null;
}

/** Kubernetes minor versions, rendered as `1.36`. */
export function validateKubernetesVersion(value: string): string | null {
  if (value.trim().length === 0) return 'Select a Kubernetes version.';
  if (!/^\d+\.\d+$/.test(value.trim())) return 'Kubernetes versions look like 1.36.';
  return null;
}

export interface NodegroupScaling {
  minSize: number;
  maxSize: number;
  desiredSize: number;
}

/**
 * Validates one scaling configuration. Returns the problem message, or `null`
 * when the numbers are consistent (min ≤ desired ≤ max, all positive).
 */
export function validateScaling(scaling: NodegroupScaling): string | null {
  const { minSize, maxSize, desiredSize } = scaling;
  for (const [label, value] of [
    ['Minimum', minSize],
    ['Maximum', maxSize],
    ['Desired', desiredSize],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      return `${label} size must be a whole number of nodes (0 or more).`;
    }
    if (value > 1000) return `${label} size is limited to 1000 nodes.`;
  }
  if (minSize > desiredSize) return 'Minimum size cannot be larger than the desired size.';
  if (desiredSize > maxSize) return 'Desired size cannot be larger than the maximum size.';
  return null;
}

/** Parses a scaling form field; a non-integer (or a negative) is `NaN`. */
export function parseScalingValue(value: string): number {
  const trimmed = value.trim();
  // `Number.parseInt` would accept "3.9" and "3abc"; IAM/EKS count nodes, so
  // only plain non-negative integers are accepted.
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

/**
 * Parses optional positive-integer fields such as the node group disk size:
 * an empty string is `undefined` (use the service default), anything that is
 * not a plain positive integer is `NaN` and fails validation.
 */
export function parsePositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

/** Role ARNs EKS accepts for the cluster and node IAM roles. */
export const ROLE_ARN_PATTERN = /^arn:[a-z0-9-]+:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/;

/** Returns the problem with a role ARN, or `null` when it looks well formed. */
export function validateRoleArn(value: string): string | null {
  const arn = value.trim();
  if (arn.length === 0) return 'Select or enter an IAM role ARN.';
  if (!ROLE_ARN_PATTERN.test(arn)) {
    return 'Enter a role ARN such as arn:aws:iam::000000000000:role/eks-cluster-role.';
  }
  return null;
}
