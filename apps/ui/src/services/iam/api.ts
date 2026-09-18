import type { AwsTag, Paginated } from '@localdeck/shared';
import { callServiceOperation } from '../../lib/serviceOperations';
import { SERVICE_ID } from './spec';

/**
 * Typed IAM calls.
 *
 * Everything goes through the api's dynamic dispatcher (`callServiceOperation`),
 * which enforces the registry whitelist and owns the credentials: the browser
 * never talks to the AWS SDK or to LocalStack.
 *
 * LocalStack returns IAM policy documents percent-encoded (the AWS CLI decodes
 * them for display; the SDK does not), so every document read here runs through
 * {@link decodePolicyDocument} and every document written is sent as plain JSON.
 */

// ---------------------------------------------------------------- shared

/** Page size the console asks IAM for; LocalStack honors `MaxItems`. */
const PAGE_SIZE = 100;

/** Cap for the dashboard's `listAll…` helpers, so a huge account stays usable. */
const COLLECT_LIMIT = 1000;

export interface IamListOptions {
  /** `Marker` from the previous page, when one was returned. */
  nextToken?: string;
  signal?: AbortSignal;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Turns LocalStack's percent-encoded policy document back into JSON text. A
 * value that is already plain JSON (or a parsed object from another SDK
 * version) is returned unchanged.
 */
export function decodePolicyDocument(value: unknown): string | undefined {
  const text =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value);
  if (text.length === 0) return undefined;
  if (!text.includes('%')) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

interface MarkerPage {
  IsTruncated?: boolean;
  Marker?: string;
}

function toPage<T>(items: readonly T[], result: MarkerPage): Paginated<T> {
  const marker = result.Marker;
  return {
    items,
    ...(result.IsTruncated === true && marker !== undefined && marker.length > 0
      ? { nextToken: marker }
      : {}),
  };
}

/** Walks `Marker` pages until the service is done or the cap is reached. */
async function collectAll<T>(
  fetchPage: (nextToken?: string) => Promise<Paginated<T>>,
  limit = COLLECT_LIMIT,
): Promise<readonly T[]> {
  const items: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    items.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken !== undefined && items.length < limit);
  return items;
}

// ----------------------------------------------------------------- users

export interface IamUser {
  userName: string;
  userId?: string;
  arn: string;
  path?: string;
  createDate?: string;
  passwordLastUsed?: string;
  tags: readonly AwsTag[];
  /** The raw SDK object, for JSON views. */
  raw: Record<string, unknown>;
}

interface RawUser {
  UserName?: string;
  UserId?: string;
  Arn?: string;
  Path?: string;
  CreateDate?: Date | string;
  PasswordLastUsed?: Date | string;
  Tags?: AwsTag[];
}

function toIamUser(raw: RawUser): IamUser | null {
  if (typeof raw.UserName !== 'string' || raw.UserName.length === 0) return null;
  const createDate = toIso(raw.CreateDate);
  const passwordLastUsed = toIso(raw.PasswordLastUsed);
  return {
    userName: raw.UserName,
    ...(raw.UserId === undefined ? {} : { userId: raw.UserId }),
    arn: raw.Arn ?? `arn:aws:iam::000000000000:user/${raw.UserName}`,
    ...(raw.Path === undefined ? {} : { path: raw.Path }),
    ...(createDate === undefined ? {} : { createDate }),
    ...(passwordLastUsed === undefined ? {} : { passwordLastUsed }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

/** `ListUsers` — one `Marker` page. */
export async function listUsers(options: IamListOptions = {}): Promise<Paginated<IamUser>> {
  const result = await callServiceOperation<{ Users?: RawUser[] } & MarkerPage>(
    SERVICE_ID,
    'ListUsers',
    {
      MaxItems: PAGE_SIZE,
      ...(options.nextToken === undefined ? {} : { Marker: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Users ?? []).flatMap((raw): IamUser[] => {
    const user = toIamUser(raw);
    return user === null ? [] : [user];
  });
  return toPage(items, result);
}

/** Every user, paging until LocalStack is done (the dashboard's count). */
export async function listAllUsers(): Promise<readonly IamUser[]> {
  return collectAll((nextToken) => listUsers(nextToken === undefined ? {} : { nextToken }));
}

/** `GetUser`; the only read that carries the user's tags. */
export async function getUser(userName: string): Promise<IamUser> {
  const result = await callServiceOperation<{ User?: RawUser }>(SERVICE_ID, 'GetUser', {
    UserName: userName,
  });
  const user = result.User === undefined ? null : toIamUser(result.User);
  if (user === null) {
    throw new Error(`LocalStack returned no user for "${userName}".`);
  }
  return user;
}

export interface CreateUserInput {
  userName: string;
  tags: readonly AwsTag[];
}

/** `CreateUser`, with tags applied in the same call. */
export async function createUser(input: CreateUserInput): Promise<IamUser> {
  const result = await callServiceOperation<{ User?: RawUser }>(SERVICE_ID, 'CreateUser', {
    UserName: input.userName,
    ...(input.tags.length === 0 ? {} : { Tags: [...input.tags] }),
  });
  const user = result.User === undefined ? null : toIamUser(result.User);
  if (user === null) {
    throw new Error(`LocalStack returned no user for "${input.userName}".`);
  }
  return user;
}

export async function deleteUser(userName: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteUser', { UserName: userName });
}

/** `ListUserTags`. */
export async function listUserTags(userName: string): Promise<readonly AwsTag[]> {
  const result = await callServiceOperation<{ Tags?: AwsTag[] }>(SERVICE_ID, 'ListUserTags', {
    UserName: userName,
  });
  return result.Tags ?? [];
}

/**
 * Replaces a user's tag set. IAM tags are individual (`TagUser`/`UntagUser`),
 * so this reads the current set and applies the difference only.
 */
export async function putUserTags(input: {
  userName: string;
  tags: readonly AwsTag[];
}): Promise<void> {
  const current = await listUserTags(input.userName);
  const currentByKey = new Map(current.map((tag) => [tag.Key, tag.Value]));
  const nextByKey = new Map(input.tags.map((tag) => [tag.Key, tag.Value]));

  const upserts = input.tags.filter((tag) => currentByKey.get(tag.Key) !== tag.Value);
  const removedKeys = current.filter((tag) => !nextByKey.has(tag.Key)).map((tag) => tag.Key);

  if (upserts.length > 0) {
    await callServiceOperation(SERVICE_ID, 'TagUser', {
      UserName: input.userName,
      Tags: upserts,
    });
  }
  if (removedKeys.length > 0) {
    await callServiceOperation(SERVICE_ID, 'UntagUser', {
      UserName: input.userName,
      TagKeys: removedKeys,
    });
  }
}

// ------------------------------------------------------------ access keys

export interface IamAccessKey {
  accessKeyId: string;
  userName?: string;
  /** `Active` or `Inactive`. */
  status: string;
  createDate?: string;
  raw: Record<string, unknown>;
}

interface RawAccessKeyMetadata {
  AccessKeyId?: string;
  UserName?: string;
  Status?: string;
  CreateDate?: Date | string;
}

function toIamAccessKey(raw: RawAccessKeyMetadata): IamAccessKey | null {
  if (typeof raw.AccessKeyId !== 'string' || raw.AccessKeyId.length === 0) return null;
  const createDate = toIso(raw.CreateDate);
  return {
    accessKeyId: raw.AccessKeyId,
    ...(raw.UserName === undefined ? {} : { userName: raw.UserName }),
    status: raw.Status ?? 'Active',
    ...(createDate === undefined ? {} : { createDate }),
    raw: raw as Record<string, unknown>,
  };
}

/** `ListAccessKeys`; a user can have at most two keys, so no paging. */
export async function listAccessKeys(userName: string): Promise<readonly IamAccessKey[]> {
  const result = await callServiceOperation<{ AccessKeyMetadata?: RawAccessKeyMetadata[] }>(
    SERVICE_ID,
    'ListAccessKeys',
    { UserName: userName },
  );
  return (result.AccessKeyMetadata ?? []).flatMap((raw): IamAccessKey[] => {
    const key = toIamAccessKey(raw);
    return key === null ? [] : [key];
  });
}

/** A freshly created key: the secret is returned exactly this once. */
export interface CreatedAccessKey {
  accessKeyId: string;
  secretAccessKey: string;
  status: string;
  userName?: string;
  createDate?: string;
}

/** `CreateAccessKey`; the console shows the secret before leaving the modal. */
export async function createAccessKey(userName: string): Promise<CreatedAccessKey> {
  const result = await callServiceOperation<{
    AccessKey?: RawAccessKeyMetadata & { SecretAccessKey?: string };
  }>(SERVICE_ID, 'CreateAccessKey', { UserName: userName });
  const key = result.AccessKey;
  if (
    key === undefined ||
    typeof key.AccessKeyId !== 'string' ||
    typeof key.SecretAccessKey !== 'string'
  ) {
    throw new Error(`LocalStack returned no access key for "${userName}".`);
  }
  const createDate = toIso(key.CreateDate);
  return {
    accessKeyId: key.AccessKeyId,
    secretAccessKey: key.SecretAccessKey,
    status: key.Status ?? 'Active',
    ...(key.UserName === undefined ? {} : { userName: key.UserName }),
    ...(createDate === undefined ? {} : { createDate }),
  };
}

/** `UpdateAccessKey` — deactivates or reactivates one key. */
export async function updateAccessKey(input: {
  userName: string;
  accessKeyId: string;
  active: boolean;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'UpdateAccessKey', {
    UserName: input.userName,
    AccessKeyId: input.accessKeyId,
    Status: input.active ? 'Active' : 'Inactive',
  });
}

export async function deleteAccessKey(input: {
  userName: string;
  accessKeyId: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteAccessKey', {
    UserName: input.userName,
    AccessKeyId: input.accessKeyId,
  });
}

// ---------------------------------------------------------------- groups

export interface IamGroup {
  groupName: string;
  groupId?: string;
  arn: string;
  path?: string;
  createDate?: string;
  raw: Record<string, unknown>;
}

interface RawGroup {
  GroupName?: string;
  GroupId?: string;
  Arn?: string;
  Path?: string;
  CreateDate?: Date | string;
}

function toIamGroup(raw: RawGroup): IamGroup | null {
  if (typeof raw.GroupName !== 'string' || raw.GroupName.length === 0) return null;
  const createDate = toIso(raw.CreateDate);
  return {
    groupName: raw.GroupName,
    ...(raw.GroupId === undefined ? {} : { groupId: raw.GroupId }),
    arn: raw.Arn ?? `arn:aws:iam::000000000000:group/${raw.GroupName}`,
    ...(raw.Path === undefined ? {} : { path: raw.Path }),
    ...(createDate === undefined ? {} : { createDate }),
    raw: raw as Record<string, unknown>,
  };
}

/** `ListGroups` — one `Marker` page. */
export async function listGroups(options: IamListOptions = {}): Promise<Paginated<IamGroup>> {
  const result = await callServiceOperation<{ Groups?: RawGroup[] } & MarkerPage>(
    SERVICE_ID,
    'ListGroups',
    {
      MaxItems: PAGE_SIZE,
      ...(options.nextToken === undefined ? {} : { Marker: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Groups ?? []).flatMap((raw): IamGroup[] => {
    const group = toIamGroup(raw);
    return group === null ? [] : [group];
  });
  return toPage(items, result);
}

/** Every group, paging until LocalStack is done. */
export async function listAllGroups(): Promise<readonly IamGroup[]> {
  return collectAll((nextToken) => listGroups(nextToken === undefined ? {} : { nextToken }));
}

/** `GetGroup`; also returns the members, which the console's Users tab shows. */
export async function getGroup(
  groupName: string,
): Promise<{ group: IamGroup; users: readonly IamUser[] }> {
  const result = await callServiceOperation<{ Group?: RawGroup; Users?: RawUser[] }>(
    SERVICE_ID,
    'GetGroup',
    { GroupName: groupName },
  );
  const group = result.Group === undefined ? null : toIamGroup(result.Group);
  if (group === null) {
    throw new Error(`LocalStack returned no group for "${groupName}".`);
  }
  const users = (result.Users ?? []).flatMap((raw): IamUser[] => {
    const user = toIamUser(raw);
    return user === null ? [] : [user];
  });
  return { group, users };
}

export async function createGroup(groupName: string): Promise<IamGroup> {
  const result = await callServiceOperation<{ Group?: RawGroup }>(SERVICE_ID, 'CreateGroup', {
    GroupName: groupName,
  });
  const group = result.Group === undefined ? null : toIamGroup(result.Group);
  if (group === null) {
    throw new Error(`LocalStack returned no group for "${groupName}".`);
  }
  return group;
}

export async function deleteGroup(groupName: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteGroup', { GroupName: groupName });
}

/** `ListGroupsForUser`; the console's user detail Groups tab. */
export async function listGroupsForUser(userName: string): Promise<readonly IamGroup[]> {
  const result = await callServiceOperation<{ Groups?: RawGroup[] }>(
    SERVICE_ID,
    'ListGroupsForUser',
    { UserName: userName },
  );
  return (result.Groups ?? []).flatMap((raw): IamGroup[] => {
    const group = toIamGroup(raw);
    return group === null ? [] : [group];
  });
}

export async function addUserToGroup(input: {
  userName: string;
  groupName: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'AddUserToGroup', {
    UserName: input.userName,
    GroupName: input.groupName,
  });
}

export async function removeUserFromGroup(input: {
  userName: string;
  groupName: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'RemoveUserFromGroup', {
    UserName: input.userName,
    GroupName: input.groupName,
  });
}

// ----------------------------------------------------------------- roles

export interface IamRole {
  roleName: string;
  roleId?: string;
  arn: string;
  path?: string;
  createDate?: string;
  description?: string;
  maxSessionDuration?: number;
  /** The trust policy, decoded to JSON text. */
  assumeRolePolicyDocument?: string;
  tags: readonly AwsTag[];
  raw: Record<string, unknown>;
}

interface RawRole {
  RoleName?: string;
  RoleId?: string;
  Arn?: string;
  Path?: string;
  CreateDate?: Date | string;
  Description?: string;
  MaxSessionDuration?: number;
  AssumeRolePolicyDocument?: unknown;
  Tags?: AwsTag[];
}

function toIamRole(raw: RawRole): IamRole | null {
  if (typeof raw.RoleName !== 'string' || raw.RoleName.length === 0) return null;
  const createDate = toIso(raw.CreateDate);
  const assumeRolePolicyDocument = decodePolicyDocument(raw.AssumeRolePolicyDocument);
  return {
    roleName: raw.RoleName,
    ...(raw.RoleId === undefined ? {} : { roleId: raw.RoleId }),
    arn: raw.Arn ?? `arn:aws:iam::000000000000:role/${raw.RoleName}`,
    ...(raw.Path === undefined ? {} : { path: raw.Path }),
    ...(createDate === undefined ? {} : { createDate }),
    ...(raw.Description === undefined ? {} : { description: raw.Description }),
    ...(raw.MaxSessionDuration === undefined ? {} : { maxSessionDuration: raw.MaxSessionDuration }),
    ...(assumeRolePolicyDocument === undefined ? {} : { assumeRolePolicyDocument }),
    tags: raw.Tags ?? [],
    raw: raw as Record<string, unknown>,
  };
}

/** `ListRoles` — one `Marker` page. */
export async function listRoles(options: IamListOptions = {}): Promise<Paginated<IamRole>> {
  const result = await callServiceOperation<{ Roles?: RawRole[] } & MarkerPage>(
    SERVICE_ID,
    'ListRoles',
    {
      MaxItems: PAGE_SIZE,
      ...(options.nextToken === undefined ? {} : { Marker: options.nextToken }),
    },
    options.signal,
  );
  const items = (result.Roles ?? []).flatMap((raw): IamRole[] => {
    const role = toIamRole(raw);
    return role === null ? [] : [role];
  });
  return toPage(items, result);
}

/** Every role, paging until LocalStack is done. */
export async function listAllRoles(): Promise<readonly IamRole[]> {
  return collectAll((nextToken) => listRoles(nextToken === undefined ? {} : { nextToken }));
}

export async function getRole(roleName: string): Promise<IamRole> {
  const result = await callServiceOperation<{ Role?: RawRole }>(SERVICE_ID, 'GetRole', {
    RoleName: roleName,
  });
  const role = result.Role === undefined ? null : toIamRole(result.Role);
  if (role === null) {
    throw new Error(`LocalStack returned no role for "${roleName}".`);
  }
  return role;
}

export interface CreateRoleInput {
  roleName: string;
  /** Plain JSON (not percent-encoded); LocalStack parses it as the trust policy. */
  trustPolicy: string;
  description?: string;
  tags: readonly AwsTag[];
}

/** `CreateRole` with the trust policy, description and tags in one call. */
export async function createRole(input: CreateRoleInput): Promise<IamRole> {
  const result = await callServiceOperation<{ Role?: RawRole }>(SERVICE_ID, 'CreateRole', {
    RoleName: input.roleName,
    AssumeRolePolicyDocument: input.trustPolicy,
    ...(input.description === undefined || input.description.length === 0
      ? {}
      : { Description: input.description }),
    ...(input.tags.length === 0 ? {} : { Tags: [...input.tags] }),
  });
  const role = result.Role === undefined ? null : toIamRole(result.Role);
  if (role === null) {
    throw new Error(`LocalStack returned no role for "${input.roleName}".`);
  }
  return role;
}

export async function deleteRole(roleName: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeleteRole', { RoleName: roleName });
}

/** `UpdateAssumeRolePolicy` — replaces the trust policy (no versioning). */
export async function updateAssumeRolePolicy(input: {
  roleName: string;
  trustPolicy: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'UpdateAssumeRolePolicy', {
    RoleName: input.roleName,
    PolicyDocument: input.trustPolicy,
  });
}

/** `ListRoleTags`. */
export async function listRoleTags(roleName: string): Promise<readonly AwsTag[]> {
  const result = await callServiceOperation<{ Tags?: AwsTag[] }>(SERVICE_ID, 'ListRoleTags', {
    RoleName: roleName,
  });
  return result.Tags ?? [];
}

/** Replaces a role's tag set via `TagRole`/`UntagRole` (see putUserTags). */
export async function putRoleTags(input: {
  roleName: string;
  tags: readonly AwsTag[];
}): Promise<void> {
  const current = await listRoleTags(input.roleName);
  const currentByKey = new Map(current.map((tag) => [tag.Key, tag.Value]));
  const nextByKey = new Map(input.tags.map((tag) => [tag.Key, tag.Value]));

  const upserts = input.tags.filter((tag) => currentByKey.get(tag.Key) !== tag.Value);
  const removedKeys = current.filter((tag) => !nextByKey.has(tag.Key)).map((tag) => tag.Key);

  if (upserts.length > 0) {
    await callServiceOperation(SERVICE_ID, 'TagRole', {
      RoleName: input.roleName,
      Tags: upserts,
    });
  }
  if (removedKeys.length > 0) {
    await callServiceOperation(SERVICE_ID, 'UntagRole', {
      RoleName: input.roleName,
      TagKeys: removedKeys,
    });
  }
}

// -------------------------------------------------------------- policies

/** `Local` is "Customer managed", `AWS` is "AWS managed". */
export type IamPolicyScope = 'Local' | 'AWS';

export interface IamPolicy {
  policyName: string;
  policyId?: string;
  arn: string;
  path?: string;
  defaultVersionId?: string;
  attachmentCount: number;
  isAttachable: boolean;
  createDate?: string;
  updateDate?: string;
  /** `Local` or `AWS`; how the console labels the policy type. */
  scope?: IamPolicyScope;
  raw: Record<string, unknown>;
}

interface RawPolicy {
  PolicyName?: string;
  PolicyId?: string;
  Arn?: string;
  Path?: string;
  DefaultVersionId?: string;
  AttachmentCount?: number;
  PermissionsBoundaryUsageCount?: number;
  IsAttachable?: boolean;
  CreateDate?: Date | string;
  UpdateDate?: Date | string;
}

function toIamPolicy(raw: RawPolicy, scope?: IamPolicyScope): IamPolicy | null {
  if (typeof raw.PolicyName !== 'string' || raw.PolicyName.length === 0) return null;
  const arn = raw.Arn ?? '';
  const createDate = toIso(raw.CreateDate);
  const updateDate = toIso(raw.UpdateDate);
  const resolvedScope =
    scope ??
    (arn.startsWith('arn:aws:iam::aws:policy/') ? 'AWS' : arn.length > 0 ? 'Local' : undefined);
  return {
    policyName: raw.PolicyName,
    ...(raw.PolicyId === undefined ? {} : { policyId: raw.PolicyId }),
    arn,
    ...(raw.Path === undefined ? {} : { path: raw.Path }),
    ...(raw.DefaultVersionId === undefined ? {} : { defaultVersionId: raw.DefaultVersionId }),
    attachmentCount: typeof raw.AttachmentCount === 'number' ? raw.AttachmentCount : 0,
    isAttachable: raw.IsAttachable ?? true,
    ...(createDate === undefined ? {} : { createDate }),
    ...(updateDate === undefined ? {} : { updateDate }),
    ...(resolvedScope === undefined ? {} : { scope: resolvedScope }),
    raw: raw as Record<string, unknown>,
  };
}

/** `ListPolicies` for one scope — one `Marker` page. */
export async function listPolicies(
  input: { scope: IamPolicyScope } & IamListOptions,
): Promise<Paginated<IamPolicy>> {
  const result = await callServiceOperation<{ Policies?: RawPolicy[] } & MarkerPage>(
    SERVICE_ID,
    'ListPolicies',
    {
      Scope: input.scope,
      MaxItems: PAGE_SIZE,
      ...(input.nextToken === undefined ? {} : { Marker: input.nextToken }),
    },
    input.signal,
  );
  const items = (result.Policies ?? []).flatMap((raw): IamPolicy[] => {
    const policy = toIamPolicy(raw, input.scope);
    return policy === null ? [] : [policy];
  });
  return toPage(items, result);
}

/**
 * Every policy of one scope, paging until LocalStack is done. The AWS managed
 * collection has more than a thousand entries, so the dashboard only collects
 * the customer-managed scope and the policies list pages lazily.
 */
export async function listAllPolicies(scope: IamPolicyScope): Promise<readonly IamPolicy[]> {
  return collectAll((nextToken) =>
    listPolicies(nextToken === undefined ? { scope } : { scope, nextToken }),
  );
}

export async function getPolicy(policyArn: string): Promise<IamPolicy> {
  const result = await callServiceOperation<{ Policy?: RawPolicy }>(SERVICE_ID, 'GetPolicy', {
    PolicyArn: policyArn,
  });
  const policy = result.Policy === undefined ? null : toIamPolicy(result.Policy);
  if (policy === null) {
    throw new Error(`LocalStack returned no policy for "${policyArn}".`);
  }
  return policy;
}

export interface CreatePolicyInput {
  policyName: string;
  /** Plain JSON identity policy document. */
  policyDocument: string;
  description?: string;
}

/** `CreatePolicy`; the document is validated client-side before this runs. */
export async function createPolicy(input: CreatePolicyInput): Promise<IamPolicy> {
  const result = await callServiceOperation<{ Policy?: RawPolicy }>(SERVICE_ID, 'CreatePolicy', {
    PolicyName: input.policyName,
    PolicyDocument: input.policyDocument,
    ...(input.description === undefined || input.description.length === 0
      ? {}
      : { Description: input.description }),
  });
  const policy = result.Policy === undefined ? null : toIamPolicy(result.Policy);
  if (policy === null) {
    throw new Error(`LocalStack returned no policy for "${input.policyName}".`);
  }
  return policy;
}

export async function deletePolicy(policyArn: string): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'DeletePolicy', { PolicyArn: policyArn });
}

/**
 * `GetPolicyVersion` — the policy document, decoded to JSON text.
 *
 * LocalStack requires an explicit `VersionId` here (a request without one
 * answers a 500), so a missing version is resolved from the policy's default
 * first.
 */
export async function getPolicyDocument(input: {
  policyArn: string;
  versionId?: string;
}): Promise<string> {
  const versionId = input.versionId ?? (await getPolicy(input.policyArn)).defaultVersionId;
  if (versionId === undefined) {
    throw new Error(`LocalStack did not report a default version for "${input.policyArn}".`);
  }
  const result = await callServiceOperation<{ PolicyVersion?: { Document?: unknown } }>(
    SERVICE_ID,
    'GetPolicyVersion',
    { PolicyArn: input.policyArn, VersionId: versionId },
  );
  return decodePolicyDocument(result.PolicyVersion?.Document) ?? '';
}

/**
 * `CreatePolicyVersion` with `SetAsDefault`: editing a customer managed policy
 * is a new version in IAM, never an in-place update.
 */
export async function createPolicyVersion(input: {
  policyArn: string;
  policyDocument: string;
}): Promise<void> {
  await callServiceOperation(SERVICE_ID, 'CreatePolicyVersion', {
    PolicyArn: input.policyArn,
    PolicyDocument: input.policyDocument,
    SetAsDefault: true,
  });
}

export interface IamPolicyEntities {
  users: readonly { name: string; id?: string }[];
  groups: readonly { name: string; id?: string }[];
  roles: readonly { name: string; id?: string }[];
}

/** `ListEntitiesForPolicy` — who the policy is attached to. */
export async function listEntitiesForPolicy(policyArn: string): Promise<IamPolicyEntities> {
  const result = await callServiceOperation<{
    PolicyUsers?: { UserName?: string; UserId?: string }[];
    PolicyGroups?: { GroupName?: string; GroupId?: string }[];
    PolicyRoles?: { RoleName?: string; RoleId?: string }[];
  }>(SERVICE_ID, 'ListEntitiesForPolicy', { PolicyArn: policyArn });

  const nameOf = (value: string | undefined): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  return {
    users: (result.PolicyUsers ?? []).flatMap((entry) => {
      const name = nameOf(entry.UserName);
      return name === null
        ? []
        : [{ name, ...(entry.UserId === undefined ? {} : { id: entry.UserId }) }];
    }),
    groups: (result.PolicyGroups ?? []).flatMap((entry) => {
      const name = nameOf(entry.GroupName);
      return name === null
        ? []
        : [{ name, ...(entry.GroupId === undefined ? {} : { id: entry.GroupId }) }];
    }),
    roles: (result.PolicyRoles ?? []).flatMap((entry) => {
      const name = nameOf(entry.RoleName);
      return name === null
        ? []
        : [{ name, ...(entry.RoleId === undefined ? {} : { id: entry.RoleId }) }];
    }),
  };
}

// ------------------------------------------------------- attached policies

/** The three entities IAM can attach a policy to. */
export type AttachedEntityKind = 'user' | 'group' | 'role';

interface AttachedEntityOperations {
  list: string;
  attach: string;
  detach: string;
  /** Input field that names the entity. */
  field: 'UserName' | 'GroupName' | 'RoleName';
}

const ATTACHED_OPERATIONS: Readonly<Record<AttachedEntityKind, AttachedEntityOperations>> = {
  user: {
    list: 'ListAttachedUserPolicies',
    attach: 'AttachUserPolicy',
    detach: 'DetachUserPolicy',
    field: 'UserName',
  },
  group: {
    list: 'ListAttachedGroupPolicies',
    attach: 'AttachGroupPolicy',
    detach: 'DetachGroupPolicy',
    field: 'GroupName',
  },
  role: {
    list: 'ListAttachedRolePolicies',
    attach: 'AttachRolePolicy',
    detach: 'DetachRolePolicy',
    field: 'RoleName',
  },
};

export interface IamAttachedPolicy {
  policyName: string;
  policyArn: string;
  /** `AWS` for AWS managed policies, `Local` otherwise. */
  scope: IamPolicyScope;
  raw: Record<string, unknown>;
}

interface RawAttachedPolicy {
  PolicyName?: string;
  PolicyArn?: string;
}

/** `ListAttached*Policies` for a user, group or role. */
export async function listAttachedPolicies(
  entity: AttachedEntityKind,
  name: string,
): Promise<readonly IamAttachedPolicy[]> {
  const target = ATTACHED_OPERATIONS[entity];
  const result = await callServiceOperation<{ AttachedPolicies?: RawAttachedPolicy[] }>(
    SERVICE_ID,
    target.list,
    { [target.field]: name },
  );
  return (result.AttachedPolicies ?? []).flatMap((raw): IamAttachedPolicy[] => {
    if (typeof raw.PolicyName !== 'string' || typeof raw.PolicyArn !== 'string') return [];
    return [
      {
        policyName: raw.PolicyName,
        policyArn: raw.PolicyArn,
        scope: raw.PolicyArn.startsWith('arn:aws:iam::aws:policy/') ? 'AWS' : 'Local',
        raw: raw as Record<string, unknown>,
      },
    ];
  });
}

export async function attachPolicy(
  entity: AttachedEntityKind,
  name: string,
  policyArn: string,
): Promise<void> {
  const target = ATTACHED_OPERATIONS[entity];
  await callServiceOperation(SERVICE_ID, target.attach, {
    [target.field]: name,
    PolicyArn: policyArn,
  });
}

export async function detachPolicy(
  entity: AttachedEntityKind,
  name: string,
  policyArn: string,
): Promise<void> {
  const target = ATTACHED_OPERATIONS[entity];
  await callServiceOperation(SERVICE_ID, target.detach, {
    [target.field]: name,
    PolicyArn: policyArn,
  });
}
