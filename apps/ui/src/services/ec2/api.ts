import type { AwsTag, Paginated } from '@localdeck/shared';
import { ApiClientError, toApiError } from '../../lib/apiClient';
import { callServiceOperation } from '../../lib/serviceOperations';
import { SERVICE_ID } from './spec';

/**
 * Typed EC2 calls.
 *
 * Everything goes through the api's dynamic dispatcher (`callServiceOperation`),
 * which enforces the registry whitelist and owns the credentials: the browser
 * never talks to the AWS SDK or to LocalStack.
 *
 * The installed `@aws-sdk/client-ec2` model is newer than the LocalStack EC2
 * implementation in a few places — most visibly `CreateSecurityGroup`, whose
 * description member is spelled `Description` in SDK v3.1135 and serializes to
 * the legacy `GroupDescription` query parameter LocalStack expects. Inputs here
 * always use the SDK's spelling, responses always use the SDK's output spelling.
 */

// ---------------------------------------------------------------- shared

/** Page size the console asks EC2 for. */
const PAGE_SIZE = 100;

export interface Ec2ListOptions {
  /** `NextToken` from the previous page, when one was returned. */
  nextToken?: string;
  signal?: AbortSignal;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A resource the service no longer returns. Shaped like an api error so pages
 * render it through the same error state as an upstream 404 instead of the
 * generic "api unreachable" wording.
 */
function notFound(message: string): ApiClientError {
  return new ApiClientError({ code: 'NOT_FOUND', statusCode: 404, message });
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

interface TokenPage {
  NextToken?: string;
}

function toPage<T>(items: readonly T[], result: TokenPage): Paginated<T> {
  const nextToken = result.NextToken;
  return {
    items,
    ...(nextToken === undefined || nextToken.length === 0 ? {} : { nextToken }),
  };
}

/**
 * A dashboard count read from a single page. `hasMore` says the service had
 * more pages; the caller renders "100+" instead of paying for a full sweep.
 */
export interface Ec2Count {
  count: number;
  hasMore: boolean;
}

function toCount(page: Paginated<unknown>): Ec2Count {
  // A full page is not proof of more results: LocalStack can answer exactly
  // `MaxResults` items with no NextToken. Only a token means there is more.
  return {
    count: page.items.length,
    hasMore: page.nextToken !== undefined,
  };
}

/**
 * Walks `NextToken` pages until the service stops returning a token. A token
 * the service already returned is treated as the end of the chain, so a buggy
 * backend answering with the same token forever cannot spin the loop.
 */
async function collectAll<T>(
  fetchPage: (nextToken?: string) => Promise<Paginated<T>>,
): Promise<readonly T[]> {
  const items: T[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  for (;;) {
    const page = await fetchPage(nextToken);
    items.push(...page.items);
    const token = page.nextToken;
    if (token === undefined || seenTokens.has(token)) break;
    seenTokens.add(token);
    nextToken = token;
  }
  return items;
}

/**
 * A client token for the idempotent create calls (`RunInstances`,
 * `CreateVolume`): a double-submit or a retried request reuses the same token
 * instead of creating a second resource.
 */
export function newClientToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Browsers without `randomUUID` (older WebViews) still get a unique-enough
  // token; the token only has to be stable for one user action.
  return `localdeck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------------------------------------- instances

/** The lifecycle states `DescribeInstances` reports (`unknown` is defensive). */
export type Ec2InstanceState =
  'pending' | 'running' | 'shutting-down' | 'terminated' | 'stopping' | 'stopped' | 'unknown';

/** States that keep changing on their own, so the console auto-refreshes. */
const TRANSITIONAL_STATES: ReadonlySet<string> = new Set(['pending', 'stopping', 'shutting-down']);

/** True while the instance is still settling (the list polls every 10 s). */
export function isTransitionalInstanceState(state: string): boolean {
  return TRANSITIONAL_STATES.has(state);
}

/** The `Name` tag the console shows first, if the instance has one. */
export function instanceName(instance: Pick<Ec2Instance, 'name' | 'instanceId'>): string {
  return instance.name ?? instance.instanceId;
}

export interface Ec2InstanceSecurityGroup {
  id: string;
  name?: string;
}

export interface Ec2InstanceBlockDevice {
  deviceName?: string;
  volumeId?: string;
  deleteOnTermination?: boolean;
  volumeSizeGiB?: number;
  volumeType?: string;
}

export interface Ec2Instance {
  instanceId: string;
  /** Value of the `Name` tag. */
  name?: string;
  state: Ec2InstanceState;
  stateCode?: number;
  instanceType: string;
  availabilityZone?: string;
  launchTime?: string;
  imageId?: string;
  keyName?: string;
  architecture?: string;
  platformDetails?: string;
  rootDeviceName?: string;
  rootDeviceType?: string;
  virtualizationType?: string;
  privateIpAddress?: string;
  publicIpAddress?: string;
  privateDnsName?: string;
  publicDnsName?: string;
  vpcId?: string;
  subnetId?: string;
  monitoringState?: string;
  securityGroups: readonly Ec2InstanceSecurityGroup[];
  blockDevices: readonly Ec2InstanceBlockDevice[];
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawInstance {
  InstanceId?: string;
  InstanceType?: string;
  State?: { Name?: string; Code?: number };
  Placement?: { AvailabilityZone?: string; Tenancy?: string };
  LaunchTime?: Date | string;
  ImageId?: string;
  KeyName?: string;
  Architecture?: string;
  PlatformDetails?: string;
  RootDeviceName?: string;
  RootDeviceType?: string;
  VirtualizationType?: string;
  PrivateIpAddress?: string;
  PublicIpAddress?: string;
  PrivateDnsName?: string;
  PublicDnsName?: string;
  VpcId?: string;
  SubnetId?: string;
  Monitoring?: { State?: string };
  SecurityGroups?: { GroupId?: string; GroupName?: string }[];
  BlockDeviceMappings?: {
    DeviceName?: string;
    Ebs?: {
      VolumeId?: string;
      DeleteOnTermination?: boolean;
      VolumeSize?: number;
      VolumeType?: string;
    };
  }[];
  Tags?: AwsTag[];
}

const KNOWN_STATES: ReadonlySet<string> = new Set([
  'pending',
  'running',
  'shutting-down',
  'terminated',
  'stopping',
  'stopped',
]);

/** Maps a raw SDK instance; returns `null` without an instance id. */
export function toEc2Instance(raw: RawInstance): Ec2Instance | null {
  const instanceId = toStringValue(raw.InstanceId);
  if (instanceId === undefined) return null;
  const stateName = toStringValue(raw.State?.Name) ?? 'unknown';
  const state: Ec2InstanceState = KNOWN_STATES.has(stateName)
    ? (stateName as Ec2InstanceState)
    : 'unknown';
  const tags = raw.Tags ?? [];
  const name = tags.find((tag) => tag.Key === 'Name')?.Value;
  const launchTime = toIso(raw.LaunchTime);
  const availabilityZone = toStringValue(raw.Placement?.AvailabilityZone);

  return {
    instanceId,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    state,
    ...(raw.State?.Code === undefined ? {} : { stateCode: raw.State.Code }),
    instanceType: toStringValue(raw.InstanceType) ?? 'unknown',
    ...(availabilityZone === undefined ? {} : { availabilityZone }),
    ...(launchTime === undefined ? {} : { launchTime }),
    ...(toStringValue(raw.ImageId) === undefined ? {} : { imageId: raw.ImageId as string }),
    ...(toStringValue(raw.KeyName) === undefined ? {} : { keyName: raw.KeyName as string }),
    ...(toStringValue(raw.Architecture) === undefined
      ? {}
      : { architecture: raw.Architecture as string }),
    ...(toStringValue(raw.PlatformDetails) === undefined
      ? {}
      : { platformDetails: raw.PlatformDetails as string }),
    ...(toStringValue(raw.RootDeviceName) === undefined
      ? {}
      : { rootDeviceName: raw.RootDeviceName as string }),
    ...(toStringValue(raw.RootDeviceType) === undefined
      ? {}
      : { rootDeviceType: raw.RootDeviceType as string }),
    ...(toStringValue(raw.VirtualizationType) === undefined
      ? {}
      : { virtualizationType: raw.VirtualizationType as string }),
    ...(toStringValue(raw.PrivateIpAddress) === undefined
      ? {}
      : { privateIpAddress: raw.PrivateIpAddress as string }),
    ...(toStringValue(raw.PublicIpAddress) === undefined
      ? {}
      : { publicIpAddress: raw.PublicIpAddress as string }),
    ...(toStringValue(raw.PrivateDnsName) === undefined
      ? {}
      : { privateDnsName: raw.PrivateDnsName as string }),
    ...(toStringValue(raw.PublicDnsName) === undefined
      ? {}
      : { publicDnsName: raw.PublicDnsName as string }),
    ...(toStringValue(raw.VpcId) === undefined ? {} : { vpcId: raw.VpcId as string }),
    ...(toStringValue(raw.SubnetId) === undefined ? {} : { subnetId: raw.SubnetId as string }),
    ...(toStringValue(raw.Monitoring?.State) === undefined
      ? {}
      : { monitoringState: raw.Monitoring?.State as string }),
    securityGroups: (raw.SecurityGroups ?? []).flatMap((group): Ec2InstanceSecurityGroup[] => {
      const id = toStringValue(group.GroupId);
      if (id === undefined) return [];
      const name = toStringValue(group.GroupName);
      return [{ id, ...(name === undefined ? {} : { name }) }];
    }),
    blockDevices: (raw.BlockDeviceMappings ?? []).flatMap((mapping): Ec2InstanceBlockDevice[] => {
      const volumeId = toStringValue(mapping.Ebs?.VolumeId);
      return [
        {
          ...(toStringValue(mapping.DeviceName) === undefined
            ? {}
            : { deviceName: mapping.DeviceName as string }),
          ...(volumeId === undefined ? {} : { volumeId }),
          ...(mapping.Ebs?.DeleteOnTermination === undefined
            ? {}
            : { deleteOnTermination: mapping.Ebs.DeleteOnTermination }),
          ...(toNumber(mapping.Ebs?.VolumeSize) === undefined
            ? {}
            : { volumeSizeGiB: mapping.Ebs?.VolumeSize as number }),
          ...(toStringValue(mapping.Ebs?.VolumeType) === undefined
            ? {}
            : { volumeType: mapping.Ebs?.VolumeType as string }),
        },
      ];
    }),
    tags,
    raw: raw as Record<string, unknown>,
  };
}

interface Reservation {
  Instances?: RawInstance[];
}

export interface InstanceListOptions extends Ec2ListOptions {
  /** Restrict to specific instances, as the detail page does. */
  instanceIds?: readonly string[];
}

/** `DescribeInstances` — one `NextToken` page, reservations flattened. */
export async function listInstances(
  options: InstanceListOptions = {},
): Promise<Paginated<Ec2Instance>> {
  const hasExplicitIds = options.instanceIds !== undefined && options.instanceIds.length > 0;
  const result = await callServiceOperation<{ Reservations?: Reservation[] } & TokenPage>(
    SERVICE_ID,
    'DescribeInstances',
    {
      // LocalStack rejects InstanceIds together with MaxResults
      // ("InvalidParameterCombination"), so the page size is only sent for an
      // unfiltered list.
      ...(hasExplicitIds ? {} : { MaxResults: PAGE_SIZE }),
      ...(hasExplicitIds ? { InstanceIds: [...(options.instanceIds ?? [])] } : {}),
      ...(options.nextToken === undefined ? {} : { NextToken: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Reservations ?? []).flatMap((reservation) =>
    (reservation.Instances ?? []).flatMap((raw): Ec2Instance[] => {
      const instance = toEc2Instance(raw);
      return instance === null ? [] : [instance];
    }),
  );
  return toPage(items, result);
}

/** Every instance, paging until LocalStack is done (used by live tests). */
export async function listAllInstances(): Promise<readonly Ec2Instance[]> {
  return collectAll((nextToken) => listInstances(nextToken === undefined ? {} : { nextToken }));
}

/** Dashboard count: one page, with `hasMore` when the service had more. */
export async function countInstances(): Promise<Ec2Count> {
  return toCount(await listInstances());
}

/** `DescribeInstances` for one id; throws a readable error when it is gone. */
export async function getInstance(instanceId: string): Promise<Ec2Instance> {
  const page = await listInstances({ instanceIds: [instanceId] });
  // LocalStack can ignore the id filter; matching exactly keeps the detail page
  // from rendering an unrelated instance as the requested one.
  const instance = page.items.find((entry) => entry.instanceId === instanceId);
  if (instance === undefined) {
    throw notFound(`LocalStack returned no instance for "${instanceId}".`);
  }
  return instance;
}

/** One entry of a start/stop/terminate response. */
export interface Ec2InstanceStateChange {
  instanceId: string;
  previousState?: string;
  currentState: string;
}

interface RawStateChange {
  InstanceId?: string;
  PreviousState?: { Name?: string };
  CurrentState?: { Name?: string };
}

function toStateChanges(
  raw: readonly RawStateChange[] | undefined,
): readonly Ec2InstanceStateChange[] {
  return (raw ?? []).flatMap((change): Ec2InstanceStateChange[] => {
    const instanceId = toStringValue(change.InstanceId);
    if (instanceId === undefined) return [];
    const previousState = toStringValue(change.PreviousState?.Name);
    return [
      {
        instanceId,
        ...(previousState === undefined ? {} : { previousState }),
        currentState: toStringValue(change.CurrentState?.Name) ?? 'unknown',
      },
    ];
  });
}

/** `StartInstances`; returns the immediate state each instance reported. */
export async function startInstances(
  instanceIds: readonly string[],
): Promise<readonly Ec2InstanceStateChange[]> {
  const result = await callServiceOperation<{ StartingInstances?: RawStateChange[] }>(
    SERVICE_ID,
    'StartInstances',
    { InstanceIds: [...instanceIds] },
  );
  return toStateChanges(result.StartingInstances);
}

/** `StopInstances`. */
export async function stopInstances(
  instanceIds: readonly string[],
): Promise<readonly Ec2InstanceStateChange[]> {
  const result = await callServiceOperation<{ StoppingInstances?: RawStateChange[] }>(
    SERVICE_ID,
    'StopInstances',
    { InstanceIds: [...instanceIds] },
  );
  return toStateChanges(result.StoppingInstances);
}

/** `TerminateInstances`. */
export async function terminateInstances(
  instanceIds: readonly string[],
): Promise<readonly Ec2InstanceStateChange[]> {
  const result = await callServiceOperation<{ TerminatingInstances?: RawStateChange[] }>(
    SERVICE_ID,
    'TerminateInstances',
    { InstanceIds: [...instanceIds] },
  );
  return toStateChanges(result.TerminatingInstances);
}

/** `RebootInstances`; a reboot never changes the lifecycle state. */
export async function rebootInstances(instanceIds: readonly string[]): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'RebootInstances', { InstanceIds: [...instanceIds] });
}

// ---------------------------------------------------- images & types

export interface Ec2Image {
  imageId: string;
  name?: string;
  description?: string;
  state?: string;
  ownerId?: string;
  ownerAlias?: string;
  architecture?: string;
  platform?: string;
  platformDetails?: string;
  imageType?: string;
  rootDeviceName?: string;
  rootDeviceType?: string;
  virtualizationType?: string;
  creationDate?: string;
  isPublic?: boolean;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawImage {
  ImageId?: string;
  Name?: string;
  Description?: string;
  State?: string;
  OwnerId?: string;
  ImageOwnerAlias?: string;
  Architecture?: string;
  Platform?: string;
  PlatformDetails?: string;
  ImageType?: string;
  RootDeviceName?: string;
  RootDeviceType?: string;
  VirtualizationType?: string;
  CreationDate?: string;
  Public?: boolean;
  Tags?: AwsTag[];
}

/** Maps a raw SDK image; returns `null` without an image id. */
export function toEc2Image(raw: RawImage): Ec2Image | null {
  const imageId = toStringValue(raw.ImageId);
  if (imageId === undefined) return null;
  return {
    imageId,
    ...(toStringValue(raw.Name) === undefined ? {} : { name: raw.Name as string }),
    ...(toStringValue(raw.Description) === undefined
      ? {}
      : { description: raw.Description as string }),
    ...(toStringValue(raw.State) === undefined ? {} : { state: raw.State as string }),
    ...(toStringValue(raw.OwnerId) === undefined ? {} : { ownerId: raw.OwnerId as string }),
    ...(toStringValue(raw.ImageOwnerAlias) === undefined
      ? {}
      : { ownerAlias: raw.ImageOwnerAlias as string }),
    ...(toStringValue(raw.Architecture) === undefined
      ? {}
      : { architecture: raw.Architecture as string }),
    ...(toStringValue(raw.Platform) === undefined ? {} : { platform: raw.Platform as string }),
    ...(toStringValue(raw.PlatformDetails) === undefined
      ? {}
      : { platformDetails: raw.PlatformDetails as string }),
    ...(toStringValue(raw.ImageType) === undefined ? {} : { imageType: raw.ImageType as string }),
    ...(toStringValue(raw.RootDeviceName) === undefined
      ? {}
      : { rootDeviceName: raw.RootDeviceName as string }),
    ...(toStringValue(raw.RootDeviceType) === undefined
      ? {}
      : { rootDeviceType: raw.RootDeviceType as string }),
    ...(toStringValue(raw.VirtualizationType) === undefined
      ? {}
      : { virtualizationType: raw.VirtualizationType as string }),
    ...(toIso(raw.CreationDate) === undefined ? {} : { creationDate: toIso(raw.CreationDate) }),
    ...(raw.Public === undefined ? {} : { isPublic: raw.Public }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

export interface ImageListOptions extends Ec2ListOptions {
  /** `Owner` filter: `amazon`, `self`, `aws-marketplace`, an account id… */
  owners?: readonly string[];
  /** `Filters`, in the EC2 spelling (`[{ Name, Values }]`). */
  filters?: readonly { Name: string; Values: readonly string[] }[];
}

/** `DescribeImages` — one `NextToken` page. */
export async function listImages(options: ImageListOptions = {}): Promise<Paginated<Ec2Image>> {
  const result = await callServiceOperation<{ Images?: RawImage[] } & TokenPage>(
    SERVICE_ID,
    'DescribeImages',
    {
      MaxResults: PAGE_SIZE,
      ...(options.owners === undefined || options.owners.length === 0
        ? {}
        : { Owners: [...options.owners] }),
      ...(options.filters === undefined || options.filters.length === 0
        ? {}
        : {
            Filters: options.filters.map((filter) => ({ ...filter, Values: [...filter.Values] })),
          }),
      ...(options.nextToken === undefined ? {} : { NextToken: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Images ?? []).flatMap((raw): Ec2Image[] => {
    const image = toEc2Image(raw);
    return image === null ? [] : [image];
  });
  return toPage(items, result);
}

/** Every image matching the filter, paging until LocalStack is done. */
export async function listAllImages(options: ImageListOptions = {}): Promise<readonly Ec2Image[]> {
  return collectAll((nextToken) =>
    listImages({ ...options, ...(nextToken === undefined ? {} : { nextToken }) }),
  );
}

/** Dashboard count: one page, with `hasMore` when the service had more. */
export async function countImages(): Promise<Ec2Count> {
  return toCount(await listImages());
}

/** `DescribeImages` for one id; throws a readable error when it is gone. */
export async function getImage(imageId: string): Promise<Ec2Image> {
  const page = await listImages({ filters: [{ Name: 'image-id', Values: [imageId] }] });
  // The filter is not a guarantee: LocalStack has ignored it in the past, so
  // only an exact id match is acceptable.
  const image = page.items.find((entry) => entry.imageId === imageId);
  if (image === undefined) {
    throw notFound(`LocalStack returned no image for "${imageId}".`);
  }
  return image;
}

export interface Ec2InstanceType {
  instanceType: string;
  vCpus?: number;
  memoryMiB?: number;
  architecture?: string;
  currentGeneration?: boolean;
  freeTierEligible?: boolean;
  networkPerformance?: string;
  ebsOptimized?: boolean;
  instanceStorage?: string;
  gpuCount?: number;
  raw: Record<string, unknown>;
}

interface RawInstanceType {
  InstanceType?: string;
  VCpuInfo?: { DefaultVCpus?: number };
  MemoryInfo?: { SizeInMiB?: number };
  ProcessorInfo?: { SupportedArchitectures?: string[] };
  CurrentGeneration?: boolean;
  FreeTierEligible?: boolean;
  NetworkInfo?: { NetworkPerformance?: string };
  EbsInfo?: { EbsOptimizedSupport?: string };
  InstanceStorageInfo?: { Disks?: { SizeInGB?: number; Count?: number; Type?: string }[] };
  GpuInfo?: { Gpus?: { Count?: number }[] };
}

/** Maps a raw SDK instance type. */
export function toEc2InstanceType(raw: RawInstanceType): Ec2InstanceType | null {
  const instanceType = toStringValue(raw.InstanceType);
  if (instanceType === undefined) return null;

  const disks = raw.InstanceStorageInfo?.Disks ?? [];
  const diskCount = disks.reduce((sum, disk) => sum + (disk.Count ?? 0), 0);
  const instanceStorage =
    diskCount === 0
      ? 'EBS only'
      : `${diskCount} x ${disks[0]?.SizeInGB ?? '?'} GB ${disks[0]?.Type ?? ''}`.trim();

  return {
    instanceType,
    ...(toNumber(raw.VCpuInfo?.DefaultVCpus) === undefined
      ? {}
      : { vCpus: raw.VCpuInfo?.DefaultVCpus as number }),
    ...(toNumber(raw.MemoryInfo?.SizeInMiB) === undefined
      ? {}
      : { memoryMiB: raw.MemoryInfo?.SizeInMiB as number }),
    ...(toStringValue(raw.ProcessorInfo?.SupportedArchitectures?.[0]) === undefined
      ? {}
      : { architecture: raw.ProcessorInfo?.SupportedArchitectures?.[0] as string }),
    ...(raw.CurrentGeneration === undefined ? {} : { currentGeneration: raw.CurrentGeneration }),
    ...(raw.FreeTierEligible === undefined ? {} : { freeTierEligible: raw.FreeTierEligible }),
    ...(toStringValue(raw.NetworkInfo?.NetworkPerformance) === undefined
      ? {}
      : { networkPerformance: raw.NetworkInfo?.NetworkPerformance as string }),
    ...(toStringValue(raw.EbsInfo?.EbsOptimizedSupport) === undefined
      ? {}
      : { ebsOptimized: raw.EbsInfo?.EbsOptimizedSupport !== 'unsupported' }),
    instanceStorage,
    ...(raw.GpuInfo?.Gpus === undefined
      ? {}
      : {
          gpuCount: raw.GpuInfo.Gpus.reduce((sum, gpu) => sum + (gpu.Count ?? 0), 0),
        }),
    raw: raw as Record<string, unknown>,
  };
}

/** `DescribeInstanceTypes` — one `NextToken` page. */
export async function listInstanceTypes(
  options: Ec2ListOptions = {},
): Promise<Paginated<Ec2InstanceType>> {
  const result = await callServiceOperation<{ InstanceTypes?: RawInstanceType[] } & TokenPage>(
    SERVICE_ID,
    'DescribeInstanceTypes',
    {
      MaxResults: PAGE_SIZE,
      ...(options.nextToken === undefined ? {} : { NextToken: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.InstanceTypes ?? []).flatMap((raw): Ec2InstanceType[] => {
    const instanceType = toEc2InstanceType(raw);
    return instanceType === null ? [] : [instanceType];
  });
  return toPage(items, result);
}

/** Every instance type LocalStack offers (the launch wizard's catalogue). */
export async function listAllInstanceTypes(): Promise<readonly Ec2InstanceType[]> {
  return collectAll((nextToken) => listInstanceTypes(nextToken === undefined ? {} : { nextToken }));
}

// ------------------------------------------------------------ key pairs

export interface Ec2KeyPair {
  keyName: string;
  keyPairId?: string;
  keyType?: string;
  keyFingerprint?: string;
  createTime?: string;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawKeyPair {
  KeyName?: string;
  KeyPairId?: string;
  KeyType?: string;
  KeyFingerprint?: string;
  CreateTime?: Date | string;
  Tags?: AwsTag[];
}

/** Maps a raw SDK key pair; returns `null` without a name. */
export function toEc2KeyPair(raw: RawKeyPair): Ec2KeyPair | null {
  const keyName = toStringValue(raw.KeyName);
  if (keyName === undefined) return null;
  const createTime = toIso(raw.CreateTime);
  return {
    keyName,
    ...(toStringValue(raw.KeyPairId) === undefined ? {} : { keyPairId: raw.KeyPairId as string }),
    ...(toStringValue(raw.KeyType) === undefined ? {} : { keyType: raw.KeyType as string }),
    ...(toStringValue(raw.KeyFingerprint) === undefined
      ? {}
      : { keyFingerprint: raw.KeyFingerprint as string }),
    ...(createTime === undefined ? {} : { createTime }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

/** `DescribeKeyPairs` (LocalStack returns the whole set; no paging). */
export async function listKeyPairs(signal?: AbortSignal): Promise<readonly Ec2KeyPair[]> {
  const result = await callServiceOperation<{ KeyPairs?: RawKeyPair[] }>(
    SERVICE_ID,
    'DescribeKeyPairs',
    {},
    signal,
  );
  return (result.KeyPairs ?? []).flatMap((raw): Ec2KeyPair[] => {
    const pair = toEc2KeyPair(raw);
    return pair === null ? [] : [pair];
  });
}

/** A freshly created key pair: the private key is returned exactly this once. */
export interface CreatedEc2KeyPair {
  keyName: string;
  keyPairId?: string;
  keyFingerprint?: string;
  /** PEM-encoded RSA private key. */
  keyMaterial: string;
}

/** `CreateKeyPair`; the console shows the .pem before leaving the wizard. */
export async function createKeyPair(keyName: string): Promise<CreatedEc2KeyPair> {
  // The EC2 API has no ClientToken for CreateKeyPair: idempotency is the
  // caller's job. The launch wizard keeps the created pair across retries
  // instead of calling CreateKeyPair again with the same name.
  const result = await callServiceOperation<{
    KeyName?: string;
    KeyPairId?: string;
    KeyFingerprint?: string;
    KeyMaterial?: string;
  }>(SERVICE_ID, 'CreateKeyPair', { KeyName: keyName, KeyType: 'rsa' });
  if (typeof result.KeyMaterial !== 'string' || result.KeyMaterial.length === 0) {
    throw notFound(`LocalStack returned no key material for "${keyName}".`);
  }
  return {
    keyName: result.KeyName ?? keyName,
    ...(result.KeyPairId === undefined ? {} : { keyPairId: result.KeyPairId }),
    ...(result.KeyFingerprint === undefined ? {} : { keyFingerprint: result.KeyFingerprint }),
    keyMaterial: result.KeyMaterial,
  };
}

/** `DeleteKeyPair`. */
export async function deleteKeyPair(keyName: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteKeyPair', { KeyName: keyName });
}

// ------------------------------------------------------ security groups

export interface Ec2SecurityGroupRule {
  /** `tcp`, `udp`, `icmp`, `-1` (all traffic). */
  protocol: string;
  fromPort?: number;
  toPort?: number;
  description?: string;
  ipv4Ranges: readonly string[];
  ipv6Ranges: readonly string[];
  prefixListIds: readonly string[];
  referencedGroups: readonly string[];
  raw: Record<string, unknown>;
}

export interface Ec2SecurityGroup {
  groupId: string;
  groupName: string;
  description: string;
  vpcId?: string;
  ownerId?: string;
  arn?: string;
  inbound: readonly Ec2SecurityGroupRule[];
  outbound: readonly Ec2SecurityGroupRule[];
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawSecurityGroupRule {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  Description?: string;
  IpRanges?: { CidrIp?: string }[];
  Ipv6Ranges?: { CidrIpv6?: string }[];
  PrefixListIds?: { PrefixListId?: string }[];
  UserIdGroupPairs?: { GroupId?: string; GroupName?: string }[];
}

interface RawSecurityGroup {
  GroupId?: string;
  GroupName?: string;
  Description?: string;
  GroupDescription?: string;
  VpcId?: string;
  OwnerId?: string;
  SecurityGroupArn?: string;
  IpPermissions?: RawSecurityGroupRule[];
  IpPermissionsEgress?: RawSecurityGroupRule[];
  Tags?: AwsTag[];
}

function toSecurityGroupRule(raw: RawSecurityGroupRule): Ec2SecurityGroupRule {
  return {
    protocol: toStringValue(raw.IpProtocol) ?? '-1',
    ...(toNumber(raw.FromPort) === undefined ? {} : { fromPort: raw.FromPort as number }),
    ...(toNumber(raw.ToPort) === undefined ? {} : { toPort: raw.ToPort as number }),
    ...(toStringValue(raw.Description) === undefined
      ? {}
      : { description: raw.Description as string }),
    ipv4Ranges: (raw.IpRanges ?? []).flatMap((range) =>
      toStringValue(range.CidrIp) === undefined ? [] : [range.CidrIp as string],
    ),
    ipv6Ranges: (raw.Ipv6Ranges ?? []).flatMap((range) =>
      toStringValue(range.CidrIpv6) === undefined ? [] : [range.CidrIpv6 as string],
    ),
    prefixListIds: (raw.PrefixListIds ?? []).flatMap((entry) =>
      toStringValue(entry.PrefixListId) === undefined ? [] : [entry.PrefixListId as string],
    ),
    referencedGroups: (raw.UserIdGroupPairs ?? []).flatMap((pair) => {
      const id = toStringValue(pair.GroupId) ?? toStringValue(pair.GroupName);
      return id === undefined ? [] : [id];
    }),
    raw: raw as Record<string, unknown>,
  };
}

/**
 * Maps a raw SDK security group. The description arrives as `Description` from
 * the current SDK model; older serializations used `GroupDescription`.
 */
export function toEc2SecurityGroup(raw: RawSecurityGroup): Ec2SecurityGroup | null {
  const groupId = toStringValue(raw.GroupId);
  if (groupId === undefined) return null;
  return {
    groupId,
    groupName: toStringValue(raw.GroupName) ?? groupId,
    description: toStringValue(raw.Description) ?? toStringValue(raw.GroupDescription) ?? '',
    ...(toStringValue(raw.VpcId) === undefined ? {} : { vpcId: raw.VpcId as string }),
    ...(toStringValue(raw.OwnerId) === undefined ? {} : { ownerId: raw.OwnerId as string }),
    ...(toStringValue(raw.SecurityGroupArn) === undefined
      ? {}
      : { arn: raw.SecurityGroupArn as string }),
    inbound: (raw.IpPermissions ?? []).map(toSecurityGroupRule),
    outbound: (raw.IpPermissionsEgress ?? []).map(toSecurityGroupRule),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

export interface SecurityGroupListOptions extends Ec2ListOptions {
  groupIds?: readonly string[];
  filters?: readonly { Name: string; Values: readonly string[] }[];
}

/** `DescribeSecurityGroups` — one `NextToken` page. */
export async function listSecurityGroups(
  options: SecurityGroupListOptions = {},
): Promise<Paginated<Ec2SecurityGroup>> {
  const hasExplicitIds = options.groupIds !== undefined && options.groupIds.length > 0;
  const result = await callServiceOperation<{ SecurityGroups?: RawSecurityGroup[] } & TokenPage>(
    SERVICE_ID,
    'DescribeSecurityGroups',
    {
      ...(hasExplicitIds ? {} : { MaxResults: PAGE_SIZE }),
      ...(hasExplicitIds ? { GroupIds: [...(options.groupIds ?? [])] } : {}),
      ...(options.filters === undefined || options.filters.length === 0
        ? {}
        : {
            Filters: options.filters.map((filter) => ({ ...filter, Values: [...filter.Values] })),
          }),
      ...(options.nextToken === undefined ? {} : { NextToken: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.SecurityGroups ?? []).flatMap((raw): Ec2SecurityGroup[] => {
    const group = toEc2SecurityGroup(raw);
    return group === null ? [] : [group];
  });
  return toPage(items, result);
}

/** Every security group, paging until LocalStack is done. */
export async function listAllSecurityGroups(): Promise<readonly Ec2SecurityGroup[]> {
  return collectAll((nextToken) =>
    listSecurityGroups(nextToken === undefined ? {} : { nextToken }),
  );
}

/** Dashboard count: one page, with `hasMore` when the service had more. */
export async function countSecurityGroups(): Promise<Ec2Count> {
  return toCount(await listSecurityGroups());
}

/** `DescribeSecurityGroups` for one id. */
export async function getSecurityGroup(groupId: string): Promise<Ec2SecurityGroup> {
  const result = await callServiceOperation<{ SecurityGroups?: RawSecurityGroup[] }>(
    SERVICE_ID,
    'DescribeSecurityGroups',
    { GroupIds: [groupId] },
  );
  // The id filter is not a guarantee: LocalStack has ignored it in the past, so
  // only an exact id match is acceptable.
  const group = (result.SecurityGroups ?? [])
    .flatMap((raw): Ec2SecurityGroup[] => {
      const mapped = toEc2SecurityGroup(raw);
      return mapped === null ? [] : [mapped];
    })
    .find((entry) => entry.groupId === groupId);
  if (group === undefined) {
    throw notFound(`LocalStack returned no security group for "${groupId}".`);
  }
  return group;
}

/**
 * The security groups an instance belongs to, with their rules. The caller
 * passes the ids it already has (from the instance description), so a refresh
 * of the instance cannot trigger an extra `DescribeSecurityGroups` call.
 */
export async function listSecurityGroupsByIds(
  groupIds: readonly string[],
): Promise<readonly Ec2SecurityGroup[]> {
  if (groupIds.length === 0) return [];
  const result = await callServiceOperation<{ SecurityGroups?: RawSecurityGroup[] }>(
    SERVICE_ID,
    'DescribeSecurityGroups',
    { GroupIds: [...groupIds] },
  );
  return (result.SecurityGroups ?? []).flatMap((raw): Ec2SecurityGroup[] => {
    const group = toEc2SecurityGroup(raw);
    return group === null ? [] : [group];
  });
}

export interface CreateSecurityGroupInput {
  groupName: string;
  /** Rendered as the group description; sent as the SDK's `Description`. */
  description: string;
  vpcId: string;
  tags?: readonly AwsTag[];
}

/** `CreateSecurityGroup`. */
export async function createSecurityGroup(
  input: CreateSecurityGroupInput,
): Promise<Ec2SecurityGroup> {
  const result = await callServiceOperation<{ GroupId?: string }>(
    SERVICE_ID,
    'CreateSecurityGroup',
    {
      GroupName: input.groupName,
      Description: input.description,
      VpcId: input.vpcId,
      ...(input.tags === undefined || input.tags.length === 0
        ? {}
        : {
            TagSpecifications: [{ ResourceType: 'security-group', Tags: [...input.tags] }],
          }),
    },
  );
  const groupId = toStringValue(result.GroupId);
  if (groupId === undefined) {
    throw notFound(`LocalStack returned no security group for "${input.groupName}".`);
  }
  return getSecurityGroup(groupId);
}

/** One ingress/egress rule to authorize or revoke. */
export interface SecurityGroupIngressRule {
  protocol: string;
  fromPort?: number;
  toPort?: number;
  /** CIDR blocks the rule allows. */
  cidrIpv4?: readonly string[];
  cidrIpv6?: readonly string[];
  /** Source/destination security groups (`UserIdGroupPairs`). */
  referencedGroups?: readonly string[];
  /** Prefix list ids (`PrefixListIds`), e.g. `pl-…`. */
  prefixListIds?: readonly string[];
  description?: string;
}

/**
 * Maps a rule onto the SDK's `IpPermission` shape. Every member a rule can
 * carry round-trips, so a revoke reproduces exactly the stored rule instead of
 * a broader one that happens to share protocol and ports.
 */
function toIpPermission(rule: SecurityGroupIngressRule): Record<string, unknown> {
  return {
    IpProtocol: rule.protocol,
    ...(rule.fromPort === undefined ? {} : { FromPort: rule.fromPort }),
    ...(rule.toPort === undefined ? {} : { ToPort: rule.toPort }),
    ...(rule.description === undefined || rule.description.length === 0
      ? {}
      : { Description: rule.description }),
    ...(rule.cidrIpv4 === undefined || rule.cidrIpv4.length === 0
      ? {}
      : { IpRanges: rule.cidrIpv4.map((CidrIp) => ({ CidrIp })) }),
    ...(rule.cidrIpv6 === undefined || rule.cidrIpv6.length === 0
      ? {}
      : { Ipv6Ranges: rule.cidrIpv6.map((CidrIpv6) => ({ CidrIpv6 })) }),
    ...(rule.referencedGroups === undefined || rule.referencedGroups.length === 0
      ? {}
      : { UserIdGroupPairs: rule.referencedGroups.map((GroupId) => ({ GroupId })) }),
    ...(rule.prefixListIds === undefined || rule.prefixListIds.length === 0
      ? {}
      : { PrefixListIds: rule.prefixListIds.map((PrefixListId) => ({ PrefixListId })) }),
  };
}

/** `AuthorizeSecurityGroupIngress`. */
export async function authorizeSecurityGroupIngress(input: {
  groupId: string;
  rule: SecurityGroupIngressRule;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'AuthorizeSecurityGroupIngress', {
    GroupId: input.groupId,
    IpPermissions: [toIpPermission(input.rule)],
  });
}

/** `RevokeSecurityGroupIngress`. */
export async function revokeSecurityGroupIngress(input: {
  groupId: string;
  rule: SecurityGroupIngressRule;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'RevokeSecurityGroupIngress', {
    GroupId: input.groupId,
    IpPermissions: [toIpPermission(input.rule)],
  });
}

/** `DeleteSecurityGroup`. */
export async function deleteSecurityGroup(groupId: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteSecurityGroup', { GroupId: groupId });
}

// --------------------------------------------------------------- volumes

export interface Ec2VolumeAttachment {
  instanceId: string;
  device?: string;
  state?: string;
  attachTime?: string;
  deleteOnTermination?: boolean;
}

export interface Ec2Volume {
  volumeId: string;
  /** Value of the `Name` tag. */
  name?: string;
  state: string;
  sizeGiB?: number;
  volumeType?: string;
  availabilityZone?: string;
  iops?: number;
  throughput?: number;
  encrypted: boolean;
  createTime?: string;
  snapshotId?: string;
  attachments: readonly Ec2VolumeAttachment[];
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawVolume {
  VolumeId?: string;
  State?: string;
  Size?: number;
  VolumeType?: string;
  AvailabilityZone?: string;
  Iops?: number;
  Throughput?: number;
  Encrypted?: boolean;
  CreateTime?: Date | string;
  SnapshotId?: string;
  Attachments?: {
    InstanceId?: string;
    Device?: string;
    State?: string;
    AttachTime?: Date | string;
    DeleteOnTermination?: boolean;
  }[];
  Tags?: AwsTag[];
}

/** Maps a raw SDK volume; returns `null` without a volume id. */
export function toEc2Volume(raw: RawVolume): Ec2Volume | null {
  const volumeId = toStringValue(raw.VolumeId);
  if (volumeId === undefined) return null;
  const tags = raw.Tags ?? [];
  const createTime = toIso(raw.CreateTime);
  const name = tags.find((tag) => tag.Key === 'Name')?.Value;
  return {
    volumeId,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    state: toStringValue(raw.State) ?? 'unknown',
    ...(toNumber(raw.Size) === undefined ? {} : { sizeGiB: raw.Size as number }),
    ...(toStringValue(raw.VolumeType) === undefined
      ? {}
      : { volumeType: raw.VolumeType as string }),
    ...(toStringValue(raw.AvailabilityZone) === undefined
      ? {}
      : { availabilityZone: raw.AvailabilityZone as string }),
    ...(toNumber(raw.Iops) === undefined ? {} : { iops: raw.Iops as number }),
    ...(toNumber(raw.Throughput) === undefined ? {} : { throughput: raw.Throughput as number }),
    encrypted: raw.Encrypted === true,
    ...(createTime === undefined ? {} : { createTime }),
    ...(toStringValue(raw.SnapshotId) === undefined
      ? {}
      : { snapshotId: raw.SnapshotId as string }),
    attachments: (raw.Attachments ?? []).flatMap((attachment): Ec2VolumeAttachment[] => {
      const instanceId = toStringValue(attachment.InstanceId);
      if (instanceId === undefined) return [];
      const attachTime = toIso(attachment.AttachTime);
      return [
        {
          instanceId,
          ...(toStringValue(attachment.Device) === undefined
            ? {}
            : { device: attachment.Device as string }),
          ...(toStringValue(attachment.State) === undefined
            ? {}
            : { state: attachment.State as string }),
          ...(attachTime === undefined ? {} : { attachTime }),
          ...(attachment.DeleteOnTermination === undefined
            ? {}
            : { deleteOnTermination: attachment.DeleteOnTermination }),
        },
      ];
    }),
    tags,
    raw: raw as Record<string, unknown>,
  };
}

/** True while the volume is attached to (or detaching from) an instance. */
export function isVolumeAttached(volume: Pick<Ec2Volume, 'attachments' | 'state'>): boolean {
  return volume.attachments.length > 0 || volume.state === 'in-use';
}

/** States that keep changing on their own, so the volume pages auto-refresh. */
export function isTransitionalVolumeState(state: string): boolean {
  return state === 'creating' || state === 'deleting';
}

export interface VolumeListOptions extends Ec2ListOptions {
  volumeIds?: readonly string[];
  filters?: readonly { Name: string; Values: readonly string[] }[];
}

/** `DescribeVolumes` — one `NextToken` page. */
export async function listVolumes(options: VolumeListOptions = {}): Promise<Paginated<Ec2Volume>> {
  const hasExplicitIds = options.volumeIds !== undefined && options.volumeIds.length > 0;
  const result = await callServiceOperation<{ Volumes?: RawVolume[] } & TokenPage>(
    SERVICE_ID,
    'DescribeVolumes',
    {
      ...(hasExplicitIds ? {} : { MaxResults: PAGE_SIZE }),
      ...(hasExplicitIds ? { VolumeIds: [...(options.volumeIds ?? [])] } : {}),
      ...(options.filters === undefined || options.filters.length === 0
        ? {}
        : {
            Filters: options.filters.map((filter) => ({ ...filter, Values: [...filter.Values] })),
          }),
      ...(options.nextToken === undefined ? {} : { NextToken: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Volumes ?? []).flatMap((raw): Ec2Volume[] => {
    const volume = toEc2Volume(raw);
    return volume === null ? [] : [volume];
  });
  return toPage(items, result);
}

/** Every volume, paging until LocalStack is done (used by live tests). */
export async function listAllVolumes(): Promise<readonly Ec2Volume[]> {
  return collectAll((nextToken) => listVolumes(nextToken === undefined ? {} : { nextToken }));
}

/** Dashboard count: one page, with `hasMore` when the service had more. */
export async function countVolumes(): Promise<Ec2Count> {
  return toCount(await listVolumes());
}

/** `DescribeVolumes` for one id. */
export async function getVolume(volumeId: string): Promise<Ec2Volume> {
  const page = await listVolumes({ volumeIds: [volumeId] });
  // LocalStack can ignore the id filter; matching exactly keeps the detail page
  // from rendering an unrelated volume as the requested one.
  const volume = page.items.find((entry) => entry.volumeId === volumeId);
  if (volume === undefined) {
    throw notFound(`LocalStack returned no volume for "${volumeId}".`);
  }
  return volume;
}

/** The EBS volumes attached to one instance (the instance detail Storage tab). */
export async function listInstanceVolumes(instanceId: string): Promise<readonly Ec2Volume[]> {
  const result = await callServiceOperation<{ Volumes?: RawVolume[] }>(
    SERVICE_ID,
    'DescribeVolumes',
    {
      Filters: [{ Name: 'attachment.instance-id', Values: [instanceId] }],
    },
  );
  return (result.Volumes ?? []).flatMap((raw): Ec2Volume[] => {
    const volume = toEc2Volume(raw);
    return volume === null ? [] : [volume];
  });
}

export interface CreateVolumeInput {
  availabilityZone: string;
  sizeGiB: number;
  volumeType: string;
  /** Optional snapshot to create from. */
  snapshotId?: string;
  encrypted?: boolean;
  iops?: number;
  /** gp3 only: provisioned throughput in MiB/s. */
  throughput?: number;
  /** Idempotency token, so a retried submit cannot create a second volume. */
  clientToken?: string;
  tags?: readonly AwsTag[];
}

/** `CreateVolume`, with the Name tag applied in the same call. */
export async function createVolume(input: CreateVolumeInput): Promise<Ec2Volume> {
  const result = await callServiceOperation<{ VolumeId?: string }>(SERVICE_ID, 'CreateVolume', {
    AvailabilityZone: input.availabilityZone,
    Size: input.sizeGiB,
    VolumeType: input.volumeType,
    ...(input.clientToken === undefined || input.clientToken.length === 0
      ? {}
      : { ClientToken: input.clientToken }),
    ...(input.snapshotId === undefined || input.snapshotId.length === 0
      ? {}
      : { SnapshotId: input.snapshotId }),
    ...(input.encrypted === undefined ? {} : { Encrypted: input.encrypted }),
    ...(input.iops === undefined ? {} : { Iops: input.iops }),
    // `Throughput` is only valid for gp3; sending it for other types is an
    // upstream InvalidParameterCombination.
    ...(input.throughput === undefined || input.volumeType !== 'gp3'
      ? {}
      : { Throughput: input.throughput }),
    ...(input.tags === undefined || input.tags.length === 0
      ? {}
      : {
          TagSpecifications: [{ ResourceType: 'volume', Tags: [...input.tags] }],
        }),
  });
  const volumeId = toStringValue(result.VolumeId);
  if (volumeId === undefined) {
    throw notFound('LocalStack returned no volume id for the new volume.');
  }
  return getVolume(volumeId);
}

/** `AttachVolume`. */
export async function attachVolume(input: {
  volumeId: string;
  instanceId: string;
  device: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'AttachVolume', {
    VolumeId: input.volumeId,
    InstanceId: input.instanceId,
    Device: input.device,
  });
}

/** `DeleteVolume`. */
export async function deleteVolume(volumeId: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteVolume', { VolumeId: volumeId });
}

// ----------------------------------------------------------------- tags

/** `CreateTags` for any EC2 resource (instances, volumes, security groups…). */
export async function createTags(
  resourceIds: readonly string[],
  tags: readonly AwsTag[],
): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'CreateTags', {
    Resources: [...resourceIds],
    Tags: [...tags],
  });
}

/** `DeleteTags` for any EC2 resource. */
export async function deleteTags(
  resourceIds: readonly string[],
  tagKeys: readonly string[],
): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteTags', {
    Resources: [...resourceIds],
    Tags: tagKeys.map((Key) => ({ Key })),
  });
}

// ------------------------------------------------------------ networking

export interface Ec2Vpc {
  vpcId: string;
  cidrBlock?: string;
  isDefault: boolean;
  state?: string;
  dhcpOptionsId?: string;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawVpc {
  VpcId?: string;
  CidrBlock?: string;
  IsDefault?: boolean;
  State?: string;
  DhcpOptionsId?: string;
  Tags?: AwsTag[];
}

/** Maps a raw SDK VPC; returns `null` without a VPC id. */
export function toEc2Vpc(raw: RawVpc): Ec2Vpc | null {
  const vpcId = toStringValue(raw.VpcId);
  if (vpcId === undefined) return null;
  return {
    vpcId,
    ...(toStringValue(raw.CidrBlock) === undefined ? {} : { cidrBlock: raw.CidrBlock as string }),
    isDefault: raw.IsDefault === true,
    ...(toStringValue(raw.State) === undefined ? {} : { state: raw.State as string }),
    ...(toStringValue(raw.DhcpOptionsId) === undefined
      ? {}
      : { dhcpOptionsId: raw.DhcpOptionsId as string }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

/** `DescribeVpcs` (LocalStack accounts hold a handful; no paging). */
export async function listVpcs(signal?: AbortSignal): Promise<readonly Ec2Vpc[]> {
  const result = await callServiceOperation<{ Vpcs?: RawVpc[] }>(
    SERVICE_ID,
    'DescribeVpcs',
    {},
    signal,
  );
  return (result.Vpcs ?? []).flatMap((raw): Ec2Vpc[] => {
    const vpc = toEc2Vpc(raw);
    return vpc === null ? [] : [vpc];
  });
}

export interface Ec2Subnet {
  subnetId: string;
  vpcId: string;
  availabilityZone?: string;
  cidrBlock?: string;
  state?: string;
  isDefaultForAz: boolean;
  mapPublicIpOnLaunch: boolean;
  availableIpAddressCount?: number;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawSubnet {
  SubnetId?: string;
  VpcId?: string;
  AvailabilityZone?: string;
  CidrBlock?: string;
  State?: string;
  DefaultForAz?: boolean;
  MapPublicIpOnLaunch?: boolean;
  AvailableIpAddressCount?: number;
  Tags?: AwsTag[];
}

/** Maps a raw SDK subnet; returns `null` without a subnet id. */
export function toEc2Subnet(raw: RawSubnet): Ec2Subnet | null {
  const subnetId = toStringValue(raw.SubnetId);
  const vpcId = toStringValue(raw.VpcId);
  if (subnetId === undefined || vpcId === undefined) return null;
  return {
    subnetId,
    vpcId,
    ...(toStringValue(raw.AvailabilityZone) === undefined
      ? {}
      : { availabilityZone: raw.AvailabilityZone as string }),
    ...(toStringValue(raw.CidrBlock) === undefined ? {} : { cidrBlock: raw.CidrBlock as string }),
    ...(toStringValue(raw.State) === undefined ? {} : { state: raw.State as string }),
    isDefaultForAz: raw.DefaultForAz === true,
    mapPublicIpOnLaunch: raw.MapPublicIpOnLaunch === true,
    ...(toNumber(raw.AvailableIpAddressCount) === undefined
      ? {}
      : { availableIpAddressCount: raw.AvailableIpAddressCount as number }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

/** `DescribeSubnets`, optionally scoped to one VPC (the wizard's network step). */
export async function listSubnets(
  options: { vpcId?: string; signal?: AbortSignal } = {},
): Promise<readonly Ec2Subnet[]> {
  const result = await callServiceOperation<{ Subnets?: RawSubnet[] }>(
    SERVICE_ID,
    'DescribeSubnets',
    options.vpcId === undefined ? {} : { Filters: [{ Name: 'vpc-id', Values: [options.vpcId] }] },
    options.signal,
  );
  return (result.Subnets ?? []).flatMap((raw): Ec2Subnet[] => {
    const subnet = toEc2Subnet(raw);
    return subnet === null ? [] : [subnet];
  });
}

export interface Ec2AvailabilityZone {
  zoneName: string;
  zoneId?: string;
  state?: string;
  regionName?: string;
}

/** `DescribeAvailabilityZones` — the create-volume page's zone selector. */
export async function listAvailabilityZones(
  signal?: AbortSignal,
): Promise<readonly Ec2AvailabilityZone[]> {
  const result = await callServiceOperation<{
    AvailabilityZones?: {
      ZoneName?: string;
      ZoneId?: string;
      State?: string;
      RegionName?: string;
    }[];
  }>(SERVICE_ID, 'DescribeAvailabilityZones', {}, signal);
  return (result.AvailabilityZones ?? []).flatMap((zone): Ec2AvailabilityZone[] => {
    const zoneName = toStringValue(zone.ZoneName);
    if (zoneName === undefined) return [];
    return [
      {
        zoneName,
        ...(toStringValue(zone.ZoneId) === undefined ? {} : { zoneId: zone.ZoneId as string }),
        ...(toStringValue(zone.State) === undefined ? {} : { state: zone.State as string }),
        ...(toStringValue(zone.RegionName) === undefined
          ? {}
          : { regionName: zone.RegionName as string }),
      },
    ];
  });
}

// ------------------------------------------------------------- run instances

export interface RunInstancesInput {
  imageId: string;
  instanceType: string;
  /** `Name` tag plus any extra tags applied to the instance. */
  tags: readonly AwsTag[];
  keyName?: string;
  subnetId?: string;
  securityGroupIds?: readonly string[];
  availabilityZone?: string;
  /** Idempotency token, so a retried submit cannot launch a second instance. */
  clientToken?: string;
  blockDevices?: readonly {
    deviceName: string;
    sizeGiB: number;
    volumeType: string;
    deleteOnTermination: boolean;
    encrypted?: boolean;
    /** Required for io1/io2, optional for gp3. */
    iops?: number;
  }[];
}

/**
 * `RunInstances`, exactly the way the launch wizard submits it. Only the
 * instance tags travel in this call: AWS applies one `Tags` list to every
 * volume the launch creates, so the wizard names the volumes with `CreateTags`
 * after the launch instead (see {@link tagLaunchedVolumes}).
 */
export async function runInstances(input: RunInstancesInput): Promise<Ec2Instance> {
  const result = await callServiceOperation<{ Instances?: RawInstance[] }>(
    SERVICE_ID,
    'RunInstances',
    {
      ImageId: input.imageId,
      InstanceType: input.instanceType,
      MinCount: 1,
      MaxCount: 1,
      ...(input.clientToken === undefined || input.clientToken.length === 0
        ? {}
        : { ClientToken: input.clientToken }),
      ...(input.keyName === undefined || input.keyName.length === 0
        ? {}
        : { KeyName: input.keyName }),
      ...(input.subnetId === undefined || input.subnetId.length === 0
        ? {}
        : { SubnetId: input.subnetId }),
      ...(input.securityGroupIds === undefined || input.securityGroupIds.length === 0
        ? {}
        : { SecurityGroupIds: [...input.securityGroupIds] }),
      ...(input.availabilityZone === undefined || input.availabilityZone.length === 0
        ? {}
        : { Placement: { AvailabilityZone: input.availabilityZone } }),
      ...(input.blockDevices === undefined || input.blockDevices.length === 0
        ? {}
        : {
            BlockDeviceMappings: input.blockDevices.map((device) => ({
              DeviceName: device.deviceName,
              Ebs: {
                VolumeSize: device.sizeGiB,
                VolumeType: device.volumeType,
                DeleteOnTermination: device.deleteOnTermination,
                ...(device.encrypted === undefined ? {} : { Encrypted: device.encrypted }),
                ...(device.iops === undefined ? {} : { Iops: device.iops }),
              },
            })),
          }),
      ...(input.tags.length === 0
        ? {}
        : {
            TagSpecifications: [{ ResourceType: 'instance', Tags: [...input.tags] }],
          }),
    },
  );
  const raw = result.Instances?.[0];
  const instance = raw === undefined ? null : toEc2Instance(raw);
  if (instance === null) {
    throw notFound('LocalStack returned no instance for RunInstances.');
  }
  return instance;
}

/** One additional EBS volume from the launch wizard, for post-launch tagging. */
export interface LaunchAdditionalVolume {
  deviceName: string;
  /** User-provided `Name`; falls back to `<instanceName>-<deviceName>`. */
  name?: string;
}

/** One volume whose post-launch `Name` tag could not be applied. */
export interface LaunchVolumeTagFailure {
  deviceName: string;
  volumeId: string;
  message: string;
}

/**
 * Applies the `Name` tag to each EBS volume a launch created. `RunInstances`
 * can only carry one volume `Tags` list for every device, so the wizard calls
 * this after the response: the root device becomes `<instanceName>-root` and
 * each additional volume gets its user-provided name or
 * `<instanceName>-<deviceName>`.
 *
 * Volumes are matched through the returned `BlockDeviceMappings`, so a device
 * the emulator did not report is left untagged instead of guessing. Tagging is
 * best-effort: every failure is returned for the caller to report, and the
 * launch itself is never failed by a tagging error.
 */
export async function tagLaunchedVolumes(input: {
  instance: Pick<Ec2Instance, 'blockDevices' | 'rootDeviceName'>;
  instanceName: string;
  additionalVolumes: readonly LaunchAdditionalVolume[];
}): Promise<readonly LaunchVolumeTagFailure[]> {
  const trimmedName = input.instanceName.trim();
  const prefix = trimmedName.length === 0 ? 'instance' : trimmedName;

  const volumesByDevice = new Map<string, string>();
  for (const mapping of input.instance.blockDevices) {
    if (mapping.deviceName !== undefined && mapping.volumeId !== undefined) {
      volumesByDevice.set(mapping.deviceName, mapping.volumeId);
    }
  }

  const targets: { deviceName: string; volumeId: string; name: string }[] = [];
  const rootDeviceName =
    input.instance.rootDeviceName ?? input.instance.blockDevices[0]?.deviceName;
  if (rootDeviceName !== undefined) {
    const rootVolumeId = volumesByDevice.get(rootDeviceName);
    if (rootVolumeId !== undefined) {
      targets.push({ deviceName: rootDeviceName, volumeId: rootVolumeId, name: `${prefix}-root` });
    }
  }
  for (const volume of input.additionalVolumes) {
    const volumeId = volumesByDevice.get(volume.deviceName);
    if (volumeId === undefined) continue;
    const providedName = volume.name?.trim();
    targets.push({
      deviceName: volume.deviceName,
      volumeId,
      name:
        providedName === undefined || providedName.length === 0
          ? `${prefix}-${volume.deviceName}`
          : providedName,
    });
  }

  const failures: LaunchVolumeTagFailure[] = [];
  for (const target of targets) {
    try {
      await createTags([target.volumeId], [{ Key: 'Name', Value: target.name }]);
    } catch (caught) {
      failures.push({
        deviceName: target.deviceName,
        volumeId: target.volumeId,
        message: toApiError(caught).message,
      });
    }
  }
  return failures;
}
