import { eksKubeconfigPath, type AwsTag, type Paginated } from '@localdeck/shared';
import { ApiClientError, apiUrl, getText } from '../../lib/apiClient';
import { callServiceOperation } from '../../lib/serviceOperations';
import type { ResourceStatus } from '../../lib/format';
import { listAllInstances, type Ec2Instance } from '../ec2/api';
import { SERVICE_ID } from './spec';

/**
 * Typed EKS calls.
 *
 * Everything goes through the api's dynamic dispatcher (`callServiceOperation`),
 * which enforces the registry whitelist and owns the credentials: the browser
 * never talks to the AWS SDK or to LocalStack. The one exception is the
 * kubeconfig download, which is a plain file download from a dedicated api
 * route (`GET /api/eks/:cluster/kubeconfig`).
 *
 * LocalStack's EKS (Pro) backs every ACTIVE cluster with a real k3d cluster, so
 * CreateCluster/CreateNodegroup/DeleteCluster are long-running: the pages poll
 * DescribeCluster/DescribeNodegroup and never block on the SDK call.
 */

// ------------------------------------------------------------- statuses

/** The lifecycle states DescribeCluster reports. */
export type EksClusterStatus =
  'CREATING' | 'ACTIVE' | 'DELETING' | 'FAILED' | 'UPDATING' | 'PENDING';

/** The lifecycle states DescribeNodegroup reports. */
export type EksNodegroupStatus =
  'CREATING' | 'ACTIVE' | 'UPDATING' | 'DELETING' | 'CREATE_FAILED' | 'DELETE_FAILED' | 'DEGRADED';

const CLUSTER_TRANSITIONAL: ReadonlySet<string> = new Set(['CREATING', 'UPDATING', 'PENDING']);
const NODEGROUP_TRANSITIONAL: ReadonlySet<string> = new Set(['CREATING', 'UPDATING', 'DELETING']);

/** True while the cluster is still settling and the pages should poll. */
export function isClusterTransitional(status: string): boolean {
  return CLUSTER_TRANSITIONAL.has(status);
}

/** True while the node group is still settling. */
export function isNodegroupTransitional(status: string): boolean {
  return NODEGROUP_TRANSITIONAL.has(status);
}

/** Maps an EKS lifecycle state onto the console's shared status vocabulary. */
export function clusterStatusName(status: string): ResourceStatus {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'CREATING':
      return 'creating';
    case 'UPDATING':
      return 'updating';
    case 'DELETING':
      return 'deleting';
    case 'FAILED':
      return 'failed';
    case 'PENDING':
      return 'pending';
    default:
      return 'unknown';
  }
}

/** Node group wording mirrors the AWS console: CREATE_FAILED is "Create failed". */
export function nodegroupStatusName(status: string): ResourceStatus {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'CREATING':
      return 'creating';
    case 'UPDATING':
      return 'updating';
    case 'DELETING':
      return 'deleting';
    case 'CREATE_FAILED':
      return 'create-failed';
    case 'DELETE_FAILED':
      return 'delete-failed';
    case 'DEGRADED':
      return 'degraded';
    default:
      return 'unknown';
  }
}

// ------------------------------------------------------------- mapping

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** AWS tag maps (`{ key: value }`) become the console's `AwsTag[]`. */
export function toAwsTags(tags: Readonly<Record<string, string>> | undefined): readonly AwsTag[] {
  return Object.entries(tags ?? {})
    .map(([Key, Value]) => ({ Key, Value }))
    .sort((left, right) => left.Key.localeCompare(right.Key, 'en'));
}

/** The reverse of {@link toAwsTags}, for TagResource and CreateCluster. */
export function fromAwsTags(tags: readonly AwsTag[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const tag of tags) {
    if (tag.Key.trim().length === 0) continue;
    record[tag.Key] = tag.Value;
  }
  return record;
}

/**
 * A resource the service no longer returns. Shaped like an api error so pages
 * render it through the same error state as an upstream 404.
 */
function notFound(message: string): ApiClientError {
  return new ApiClientError({ code: 'NOT_FOUND', statusCode: 404, message });
}

export interface EksVpcConfig {
  subnetIds: readonly string[];
  securityGroupIds: readonly string[];
  clusterSecurityGroupId?: string;
  vpcId?: string;
  endpointPublicAccess: boolean;
  endpointPrivateAccess: boolean;
  publicAccessCidrs: readonly string[];
}

export interface EksCluster {
  name: string;
  arn: string;
  status: string;
  version: string;
  endpoint?: string;
  roleArn: string;
  platformVersion?: string;
  createdAt?: string;
  certificateAuthorityData?: string;
  oidcIssuer?: string;
  vpcConfig: EksVpcConfig;
  serviceIpv4Cidr?: string;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawVpcConfig {
  subnetIds?: string[];
  securityGroupIds?: string[];
  clusterSecurityGroupId?: string;
  vpcId?: string;
  endpointPublicAccess?: boolean;
  endpointPrivateAccess?: boolean;
  publicAccessCidrs?: string[];
}

interface RawCluster {
  name?: string;
  arn?: string;
  status?: string;
  version?: string;
  endpoint?: string;
  roleArn?: string;
  platformVersion?: string;
  createdAt?: Date | string;
  certificateAuthority?: { data?: string };
  identity?: { oidc?: { issuer?: string } };
  resourcesVpcConfig?: RawVpcConfig;
  kubernetesNetworkConfig?: { serviceIpv4Cidr?: string };
  tags?: Record<string, string>;
}

/** Maps a raw SDK cluster; returns `null` without a name. */
export function toEksCluster(raw: RawCluster): EksCluster | null {
  const name = toStringValue(raw.name);
  if (name === undefined) return null;
  const vpcConfig = raw.resourcesVpcConfig ?? {};
  const createdAt = toIso(raw.createdAt);
  const endpoint = toStringValue(raw.endpoint);
  const certificateAuthorityData = toStringValue(raw.certificateAuthority?.data);
  const platformVersion = toStringValue(raw.platformVersion);
  const oidcIssuer = toStringValue(raw.identity?.oidc?.issuer);
  const serviceIpv4Cidr = toStringValue(raw.kubernetesNetworkConfig?.serviceIpv4Cidr);
  return {
    name,
    arn: toStringValue(raw.arn) ?? `arn:aws:eks:us-east-1:000000000000:cluster/${name}`,
    status: toStringValue(raw.status) ?? 'UNKNOWN',
    version: toStringValue(raw.version) ?? 'unknown',
    ...(endpoint === undefined ? {} : { endpoint }),
    roleArn: toStringValue(raw.roleArn) ?? '',
    ...(platformVersion === undefined ? {} : { platformVersion }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(certificateAuthorityData === undefined ? {} : { certificateAuthorityData }),
    ...(oidcIssuer === undefined ? {} : { oidcIssuer }),
    vpcConfig: {
      subnetIds: vpcConfig.subnetIds ?? [],
      securityGroupIds: vpcConfig.securityGroupIds ?? [],
      ...(toStringValue(vpcConfig.clusterSecurityGroupId) === undefined
        ? {}
        : { clusterSecurityGroupId: vpcConfig.clusterSecurityGroupId as string }),
      ...(toStringValue(vpcConfig.vpcId) === undefined ? {} : { vpcId: vpcConfig.vpcId as string }),
      endpointPublicAccess: vpcConfig.endpointPublicAccess === true,
      endpointPrivateAccess: vpcConfig.endpointPrivateAccess === true,
      publicAccessCidrs: vpcConfig.publicAccessCidrs ?? [],
    },
    ...(serviceIpv4Cidr === undefined ? {} : { serviceIpv4Cidr }),
    tags: toAwsTags(raw.tags),
    raw: raw as Record<string, unknown>,
  };
}

export interface EksNodegroupScaling {
  minSize?: number;
  maxSize?: number;
  desiredSize?: number;
}

export interface EksNodegroupHealthIssue {
  code?: string;
  message?: string;
  resourceIds: readonly string[];
}

export interface EksNodegroup {
  nodegroupName: string;
  nodegroupArn: string;
  clusterName: string;
  status: string;
  version?: string;
  releaseVersion?: string;
  createdAt?: string;
  modifiedAt?: string;
  capacityType?: string;
  amiType?: string;
  instanceTypes: readonly string[];
  diskSize?: number;
  nodeRole: string;
  subnets: readonly string[];
  scaling: EksNodegroupScaling;
  autoScalingGroups: readonly string[];
  labels: Readonly<Record<string, string>>;
  healthIssues: readonly EksNodegroupHealthIssue[];
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawNodegroup {
  nodegroupName?: string;
  nodegroupArn?: string;
  clusterName?: string;
  status?: string;
  version?: string;
  releaseVersion?: string;
  createdAt?: Date | string;
  modifiedAt?: Date | string;
  capacityType?: string;
  amiType?: string;
  instanceTypes?: string[];
  diskSize?: number;
  nodeRole?: string;
  subnets?: string[];
  scalingConfig?: { minSize?: number; maxSize?: number; desiredSize?: number };
  resources?: { autoScalingGroups?: { name?: string }[] };
  labels?: Record<string, string>;
  health?: { issues?: { code?: string; message?: string; resourceIds?: string[] }[] };
  tags?: Record<string, string>;
}

/** Maps a raw SDK node group; returns `null` without a name. */
export function toEksNodegroup(raw: RawNodegroup): EksNodegroup | null {
  const nodegroupName = toStringValue(raw.nodegroupName);
  if (nodegroupName === undefined) return null;
  const createdAt = toIso(raw.createdAt);
  const modifiedAt = toIso(raw.modifiedAt);
  const version = toStringValue(raw.version);
  const releaseVersion = toStringValue(raw.releaseVersion);
  const capacityType = toStringValue(raw.capacityType);
  const amiType = toStringValue(raw.amiType);
  const diskSize = toNumber(raw.diskSize);
  const scaling = raw.scalingConfig ?? {};
  return {
    nodegroupName,
    nodegroupArn:
      toStringValue(raw.nodegroupArn) ??
      `arn:aws:eks:us-east-1:000000000000:nodegroup/${raw.clusterName ?? 'cluster'}/${nodegroupName}`,
    clusterName: toStringValue(raw.clusterName) ?? '',
    status: toStringValue(raw.status) ?? 'UNKNOWN',
    ...(version === undefined ? {} : { version }),
    ...(releaseVersion === undefined ? {} : { releaseVersion }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(capacityType === undefined ? {} : { capacityType }),
    ...(amiType === undefined ? {} : { amiType }),
    instanceTypes: raw.instanceTypes ?? [],
    ...(diskSize === undefined ? {} : { diskSize }),
    nodeRole: toStringValue(raw.nodeRole) ?? '',
    subnets: raw.subnets ?? [],
    scaling: {
      ...(toNumber(scaling.minSize) === undefined ? {} : { minSize: scaling.minSize as number }),
      ...(toNumber(scaling.maxSize) === undefined ? {} : { maxSize: scaling.maxSize as number }),
      ...(toNumber(scaling.desiredSize) === undefined
        ? {}
        : { desiredSize: scaling.desiredSize as number }),
    },
    autoScalingGroups: (raw.resources?.autoScalingGroups ?? []).flatMap((group) =>
      toStringValue(group.name) === undefined ? [] : [group.name as string],
    ),
    labels: raw.labels ?? {},
    healthIssues: (raw.health?.issues ?? []).map((issue) => ({
      ...(toStringValue(issue.code) === undefined ? {} : { code: issue.code as string }),
      ...(toStringValue(issue.message) === undefined ? {} : { message: issue.message as string }),
      resourceIds: issue.resourceIds ?? [],
    })),
    tags: toAwsTags(raw.tags),
    raw: raw as Record<string, unknown>,
  };
}

// ------------------------------------------------------------- clusters

/** `ListClusters` (LocalStack returns the whole set; no paging). */
export async function listClusterNames(signal?: AbortSignal): Promise<readonly string[]> {
  const result = await callServiceOperation<{ clusters?: string[] }>(
    SERVICE_ID,
    'ListClusters',
    {},
    signal,
  );
  return (result.clusters ?? []).filter((name) => name.length > 0);
}

/**
 * The clusters list needs status, version and creation time, which only
 * DescribeCluster reports: one describe per cluster, in parallel.
 */
export async function listClusterSummaries(signal?: AbortSignal): Promise<readonly EksCluster[]> {
  const names = await listClusterNames(signal);
  const described = await Promise.all(
    names.map(async (name): Promise<EksCluster | null> => {
      try {
        return await getCluster(name, signal);
      } catch {
        // A cluster deleted between ListClusters and DescribeCluster is skipped
        // rather than failing the whole page.
        return null;
      }
    }),
  );
  return described.flatMap((cluster): EksCluster[] => (cluster === null ? [] : [cluster]));
}

/** `DescribeCluster` for one name. */
export async function getCluster(name: string, signal?: AbortSignal): Promise<EksCluster> {
  const result = await callServiceOperation<{ cluster?: RawCluster }>(
    SERVICE_ID,
    'DescribeCluster',
    { name },
    signal,
  );
  const cluster = result.cluster === undefined ? null : toEksCluster(result.cluster);
  if (cluster === null) {
    throw notFound(`LocalStack returned no EKS cluster for "${name}".`);
  }
  return cluster;
}

export interface EksClusterVersion {
  version: string;
  defaultVersion: boolean;
  /** `STANDARD_SUPPORT` / `EXTENDED_SUPPORT`, as reported. */
  status?: string;
  platformVersion?: string;
  kubernetesPatchVersion?: string;
  releaseDate?: string;
  endOfStandardSupportDate?: string;
}

/**
 * `DescribeClusterVersions` — the create wizard's version selector. The list
 * is whatever LocalStack reports (currently Kubernetes 1.30–1.36 for the
 * k3d-backed provider), so the wizard never offers a version LocalStack cannot
 * actually start.
 */
export async function listClusterVersions(
  signal?: AbortSignal,
): Promise<readonly EksClusterVersion[]> {
  const result = await callServiceOperation<{
    clusterVersions?: {
      clusterVersion?: string;
      defaultVersion?: boolean;
      status?: string;
      versionStatus?: string;
      defaultPlatformVersion?: string;
      kubernetesPatchVersion?: string;
      releaseDate?: Date | string;
      endOfStandardSupportDate?: Date | string;
    }[];
  }>(SERVICE_ID, 'DescribeClusterVersions', {}, signal);

  return (result.clusterVersions ?? []).flatMap((entry): EksClusterVersion[] => {
    const version = toStringValue(entry.clusterVersion);
    if (version === undefined) return [];
    const status = toStringValue(entry.status) ?? toStringValue(entry.versionStatus);
    const platformVersion = toStringValue(entry.defaultPlatformVersion);
    const kubernetesPatchVersion = toStringValue(entry.kubernetesPatchVersion);
    const releaseDate = toIso(entry.releaseDate);
    const endOfStandardSupportDate = toIso(entry.endOfStandardSupportDate);
    return [
      {
        version,
        defaultVersion: entry.defaultVersion === true,
        ...(status === undefined ? {} : { status }),
        ...(platformVersion === undefined ? {} : { platformVersion }),
        ...(kubernetesPatchVersion === undefined ? {} : { kubernetesPatchVersion }),
        ...(releaseDate === undefined ? {} : { releaseDate }),
        ...(endOfStandardSupportDate === undefined ? {} : { endOfStandardSupportDate }),
      },
    ];
  });
}

export interface CreateClusterInput {
  name: string;
  version: string;
  roleArn: string;
  subnetIds: readonly string[];
  securityGroupIds?: readonly string[];
  endpointPublicAccess: boolean;
  endpointPrivateAccess: boolean;
  publicAccessCidrs?: readonly string[];
  tags?: readonly AwsTag[];
}

/**
 * `CreateCluster`. LocalStack answers immediately with status CREATING; the
 * caller polls DescribeCluster until the status settles (LocalStack starts a
 * real k3d cluster behind the scenes, which takes minutes).
 */
export async function createCluster(input: CreateClusterInput): Promise<EksCluster> {
  const result = await callServiceOperation<{ cluster?: RawCluster }>(SERVICE_ID, 'CreateCluster', {
    name: input.name,
    version: input.version,
    roleArn: input.roleArn,
    resourcesVpcConfig: {
      subnetIds: [...input.subnetIds],
      ...(input.securityGroupIds === undefined || input.securityGroupIds.length === 0
        ? {}
        : { securityGroupIds: [...input.securityGroupIds] }),
      endpointPublicAccess: input.endpointPublicAccess,
      endpointPrivateAccess: input.endpointPrivateAccess,
      ...(input.publicAccessCidrs === undefined || input.publicAccessCidrs.length === 0
        ? {}
        : { publicAccessCidrs: [...input.publicAccessCidrs] }),
    },
    ...(input.tags === undefined || input.tags.length === 0
      ? {}
      : { tags: fromAwsTags(input.tags) }),
  });
  const cluster = result.cluster === undefined ? null : toEksCluster(result.cluster);
  if (cluster === null) {
    throw notFound(`LocalStack returned no cluster for "${input.name}".`);
  }
  return cluster;
}

/** `DeleteCluster`; LocalStack tears the k3d cluster down asynchronously. */
export async function deleteCluster(name: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteCluster', { name });
}

// --------------------------------------------------------- node groups

/** `ListNodegroups` (no paging in the LocalStack implementation). */
export async function listNodegroupNames(
  clusterName: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const result = await callServiceOperation<{ nodegroups?: string[] }>(
    SERVICE_ID,
    'ListNodegroups',
    { clusterName },
    signal,
  );
  return (result.nodegroups ?? []).filter((name) => name.length > 0);
}

/** `ListNodegroups` + `DescribeNodegroup` per entry, in parallel. */
export async function listNodegroups(
  clusterName: string,
  signal?: AbortSignal,
): Promise<Paginated<EksNodegroup>> {
  const names = await listNodegroupNames(clusterName, signal);
  const described = await Promise.all(
    names.map(async (name): Promise<EksNodegroup | null> => {
      try {
        return await getNodegroup(clusterName, name, signal);
      } catch {
        return null;
      }
    }),
  );
  return { items: described.flatMap((group): EksNodegroup[] => (group === null ? [] : [group])) };
}

/** `DescribeNodegroup` for one node group. */
export async function getNodegroup(
  clusterName: string,
  nodegroupName: string,
  signal?: AbortSignal,
): Promise<EksNodegroup> {
  const result = await callServiceOperation<{ nodegroup?: RawNodegroup }>(
    SERVICE_ID,
    'DescribeNodegroup',
    { clusterName, nodegroupName },
    signal,
  );
  const nodegroup = result.nodegroup === undefined ? null : toEksNodegroup(result.nodegroup);
  if (nodegroup === null) {
    throw notFound(
      `LocalStack returned no node group "${nodegroupName}" for cluster "${clusterName}".`,
    );
  }
  return nodegroup;
}

export interface CreateNodegroupInput {
  clusterName: string;
  nodegroupName: string;
  nodeRole: string;
  subnetIds: readonly string[];
  instanceTypes: readonly string[];
  scaling: { minSize: number; maxSize: number; desiredSize: number };
  capacityType?: 'ON_DEMAND' | 'SPOT';
  amiType?: string;
  diskSizeGiB?: number;
  labels?: Readonly<Record<string, string>>;
  tags?: readonly AwsTag[];
}

/** `CreateNodegroup`. The API answers CREATING; the Compute tab polls. */
export async function createNodegroup(input: CreateNodegroupInput): Promise<EksNodegroup> {
  const result = await callServiceOperation<{ nodegroup?: RawNodegroup }>(
    SERVICE_ID,
    'CreateNodegroup',
    {
      clusterName: input.clusterName,
      nodegroupName: input.nodegroupName,
      nodeRole: input.nodeRole,
      subnets: [...input.subnetIds],
      scalingConfig: { ...input.scaling },
      ...(input.instanceTypes.length === 0 ? {} : { instanceTypes: [...input.instanceTypes] }),
      ...(input.capacityType === undefined ? {} : { capacityType: input.capacityType }),
      ...(input.amiType === undefined ? {} : { amiType: input.amiType }),
      ...(input.diskSizeGiB === undefined ? {} : { diskSize: input.diskSizeGiB }),
      ...(input.labels === undefined || Object.keys(input.labels).length === 0
        ? {}
        : { labels: { ...input.labels } }),
      ...(input.tags === undefined || input.tags.length === 0
        ? {}
        : { tags: fromAwsTags(input.tags) }),
    },
  );
  const nodegroup = result.nodegroup === undefined ? null : toEksNodegroup(result.nodegroup);
  if (nodegroup === null) {
    throw notFound(`LocalStack returned no node group for "${input.nodegroupName}".`);
  }
  return nodegroup;
}

/** `UpdateNodegroupConfig`, used for scaling min/max/desired in place. */
export async function updateNodegroupScaling(input: {
  clusterName: string;
  nodegroupName: string;
  scaling: { minSize: number; maxSize: number; desiredSize: number };
}): Promise<EksNodegroup> {
  const result = await callServiceOperation<{ nodegroup?: RawNodegroup }>(
    SERVICE_ID,
    'UpdateNodegroupConfig',
    {
      clusterName: input.clusterName,
      nodegroupName: input.nodegroupName,
      scalingConfig: { ...input.scaling },
    },
  );
  const nodegroup = result.nodegroup === undefined ? null : toEksNodegroup(result.nodegroup);
  if (nodegroup === null) {
    throw notFound(
      `LocalStack returned no node group for "${input.nodegroupName}" after the update.`,
    );
  }
  return nodegroup;
}

/** `DeleteNodegroup`. */
export async function deleteNodegroup(clusterName: string, nodegroupName: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteNodegroup', { clusterName, nodegroupName });
}

// ------------------------------------------------------------ nodegroup EC2

/**
 * The emulated EC2 instance(s) LocalStack provisions for a managed node group.
 *
 * LocalStack materialises one mocked EC2 instance per desired node, tagged the
 * way real EKS managed nodes are (`eks:nodegroup-name`, `eks:cluster-name`).
 * The matching is deliberately forgiving because tag keys differ between
 * LocalStack builds: any tag whose value is the node group name counts when
 * its key looks like a node group tag (or is the instance `Name`). When
 * nothing matches, the Compute tab links to the EC2 console instead of
 * pretending an instance exists.
 */
export function instanceBelongsToNodegroup(
  instance: Pick<Ec2Instance, 'name' | 'tags'>,
  nodegroupName: string,
): boolean {
  const name = nodegroupName.toLowerCase();
  const tagMatch = instance.tags.some((tag) => {
    if (tag.Value.toLowerCase() !== name) return false;
    const key = tag.Key.toLowerCase();
    return key === 'name' || key.includes('nodegroup') || key.includes('node-group');
  });
  return tagMatch || instance.name?.toLowerCase() === name;
}

/** Fetches the emulated EC2 instances behind one node group. */
export async function listNodegroupInstances(
  nodegroup: Pick<EksNodegroup, 'nodegroupName'>,
): Promise<readonly Ec2Instance[]> {
  let instances: readonly Ec2Instance[];
  try {
    instances = await listAllInstances();
  } catch {
    // The EC2 deep link is informational; a failure to list instances must not
    // break the node group tab.
    return [];
  }
  return instances.filter((instance) =>
    instanceBelongsToNodegroup(instance, nodegroup.nodegroupName),
  );
}

// ---------------------------------------------------------------- tags

/** `ListTagsForResource`, keyed by the cluster or node group ARN. */
export async function listTagsForResource(
  resourceArn: string,
  signal?: AbortSignal,
): Promise<readonly AwsTag[]> {
  const result = await callServiceOperation<{ tags?: Record<string, string> }>(
    SERVICE_ID,
    'ListTagsForResource',
    { resourceArn },
    signal,
  );
  return toAwsTags(result.tags);
}

/** `TagResource`. */
export async function tagResource(resourceArn: string, tags: readonly AwsTag[]): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'TagResource', {
    resourceArn,
    tags: fromAwsTags(tags),
  });
}

/** `UntagResource`. */
export async function untagResource(
  resourceArn: string,
  tagKeys: readonly string[],
): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'UntagResource', {
    resourceArn,
    tagKeys: [...tagKeys],
  });
}

// ------------------------------------------------------------ kubeconfig

/** Path of the dedicated kubeconfig download route for one cluster. */
export function kubeconfigPath(clusterName: string): string {
  return eksKubeconfigPath(clusterName);
}

/** Absolute URL of the kubeconfig route, for links and downloads. */
export function kubeconfigUrl(clusterName: string): string {
  return apiUrl(kubeconfigPath(clusterName));
}

/** Fallback file name when the api does not send Content-Disposition. */
export function kubeconfigFileName(clusterName: string): string {
  const safe = clusterName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return `kubeconfig-${safe.length === 0 ? 'cluster' : safe}.yaml`;
}

/**
 * Downloads the kubeconfig through the dedicated api route and hands it to the
 * browser as a file. The api sends `content-disposition`, but the file name is
 * derived locally as well so a proxy that strips the header cannot break the
 * download.
 */
export async function downloadKubeconfig(clusterName: string): Promise<void> {
  const { text, fileName } = await getText(kubeconfigPath(clusterName));
  const blob = new Blob([text], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName ?? kubeconfigFileName(clusterName);
  anchor.click();
  URL.revokeObjectURL(url);
}
