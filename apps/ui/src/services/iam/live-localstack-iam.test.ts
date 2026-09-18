// @vitest-environment node
/**
 * Live IAM module client test against the *running* LocalDeck api and the
 * external LocalStack it is bound to.
 *
 * It is skipped unless `VITE_LIVEDECK_LIVE_API` points at the api:
 *
 *   pnpm dev                                                       # api + ui
 *   VITE_LIVEDECK_LIVE_API=http://localhost:3001 pnpm verify:console
 *
 * The test drives the module's own `api.ts` (the same calls the console makes):
 * create policy → create role with a generated trust policy → create group and
 * user → attach policies → access-key lifecycle → memberships → delete
 * conflicts → delete. The editor's structural validation runs on the same
 * documents the console builds.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  addUserToGroup,
  attachPolicy,
  createAccessKey,
  createGroup,
  createPolicy,
  createPolicyVersion,
  createRole,
  createUser,
  deleteAccessKey,
  deleteGroup,
  deletePolicy,
  deleteRole,
  deleteUser,
  detachPolicy,
  getGroup,
  getPolicy,
  getPolicyDocument,
  getRole,
  getUser,
  listAccessKeys,
  listAllGroups,
  listAllPolicies,
  listAllRoles,
  listAllUsers,
  listAttachedPolicies,
  listEntitiesForPolicy,
  listGroupsForUser,
  listPolicies,
  listRoleTags,
  listUserTags,
  putRoleTags,
  putUserTags,
  removeUserFromGroup,
  updateAccessKey,
  updateAssumeRolePolicy,
} from './api';
import { isIamCode } from './errors';
import {
  buildIdentityPolicyText,
  buildTrustPolicyForAccount,
  buildTrustPolicyForService,
  validateIdentityPolicy,
} from './policy';

const API_BASE = import.meta.env.VITE_LIVEDECK_LIVE_API;
const liveDescribe = describe.skipIf(API_BASE === undefined);

/** Prefixes relative api paths with the live api base, like the dev proxy. */
function installLiveFetch(): void {
  const base = API_BASE ?? '';
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(typeof input === 'string' ? `${base}${input}` : input, init),
    ),
  );
}

const stamp = Date.now().toString(36);
const userName = `localdeck-iam-live-${stamp}-user`;
const groupName = `localdeck-iam-live-${stamp}-group`;
const roleName = `localdeck-iam-live-${stamp}-role`;
const policyName = `localdeck-iam-live-${stamp}-policy`;
let policyArn = '';

const policyDocument = buildIdentityPolicyText({
  effect: 'Allow',
  actions: ['s3:GetObject'],
  resources: ['arn:aws:s3:::localdeck-iam-live/*'],
});

liveDescribe('IAM module against the live api and LocalStack', () => {
  beforeAll(() => {
    installLiveFetch();
  });

  afterAll(async () => {
    // Best-effort cleanup, even when an assertion failed earlier.
    try {
      await removeUserFromGroup({ userName, groupName });
    } catch {
      // Ignore: the membership may not exist.
    }
    try {
      const keys = await listAccessKeys(userName);
      for (const key of keys) await deleteAccessKey({ userName, accessKeyId: key.accessKeyId });
    } catch {
      // Ignore: the user may not exist.
    }
    try {
      await deleteUser(userName);
    } catch {
      // Ignore.
    }
    for (const [entity, name] of [
      ['group', groupName],
      ['role', roleName],
    ] as const) {
      if (policyArn.length === 0) break;
      try {
        await detachPolicy(entity, name, policyArn);
      } catch {
        // Ignore.
      }
    }
    try {
      await deleteGroup(groupName);
    } catch {
      // Ignore.
    }
    try {
      await deleteRole(roleName);
    } catch {
      // Ignore.
    }
    if (policyArn.length > 0) {
      try {
        await deletePolicy(policyArn);
      } catch {
        // Ignore.
      }
    }
    vi.unstubAllGlobals();
  });

  it('runs the complete IAM acceptance flow', async () => {
    // 1. The editor's validation is what stops malformed documents before the
    //    api call; LocalStack rejects them too, with the code the console maps.
    expect(validateIdentityPolicy(policyDocument).valid).toBe(true);
    expect(validateIdentityPolicy('{"Version":').valid).toBe(false);
    await expect(
      createPolicy({
        policyName: `${policyName}-invalid`,
        policyDocument: '{"Version":"2012-10-17"}',
      }),
    ).rejects.toSatisfy((caught: unknown) => isIamCode(caught, 'MalformedPolicyDocument'));

    // 2. Policy: create, read, update as a new default version, attachments.
    const createdPolicy = await createPolicy({ policyName, policyDocument });
    policyArn = createdPolicy.arn;
    expect(createdPolicy.attachmentCount).toBe(0);

    const policies = await listPolicies({ scope: 'Local' });
    expect(policies.items.map((policy) => policy.policyName)).toContain(policyName);

    const fetchedPolicy = await getPolicy(policyArn);
    expect(fetchedPolicy.policyName).toBe(policyName);

    const document = await getPolicyDocument({
      policyArn,
      ...(fetchedPolicy.defaultVersionId === undefined
        ? {}
        : { versionId: fetchedPolicy.defaultVersionId }),
    });
    expect(JSON.parse(document)).toEqual(JSON.parse(policyDocument));

    await createPolicyVersion({
      policyArn,
      policyDocument: buildIdentityPolicyText({
        effect: 'Allow',
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: ['arn:aws:s3:::localdeck-iam-live/*'],
      }),
    });
    const updatedDocument = await getPolicyDocument({ policyArn });
    expect(updatedDocument).toContain('s3:PutObject');

    // 3. Role: generated trust policy, description, tags, trust-policy edit.
    const trustPolicy = buildTrustPolicyForService(['lambda.amazonaws.com']);
    const createdRole = await createRole({
      roleName,
      trustPolicy,
      description: 'LocalDeck live verification role',
      tags: [{ Key: 'env', Value: 'live-test' }],
    });
    expect(createdRole.roleName).toBe(roleName);
    expect(createdRole.assumeRolePolicyDocument).toContain('lambda.amazonaws.com');

    const fetchedRole = await getRole(roleName);
    expect(fetchedRole.description).toBe('LocalDeck live verification role');
    expect(fetchedRole.tags).toEqual([{ Key: 'env', Value: 'live-test' }]);

    await putRoleTags({
      roleName,
      tags: [
        { Key: 'env', Value: 'live-test' },
        { Key: 'team', Value: 'platform' },
      ],
    });
    expect((await listRoleTags(roleName)).map((tag) => tag.Key).sort()).toEqual(['env', 'team']);

    await updateAssumeRolePolicy({
      roleName,
      trustPolicy: buildTrustPolicyForAccount('000000000000'),
    });
    expect((await getRole(roleName)).assumeRolePolicyDocument).toContain(
      'arn:aws:iam::000000000000:root',
    );

    await attachPolicy('role', roleName, policyArn);
    expect((await listAttachedPolicies('role', roleName)).map((entry) => entry.policyArn)).toEqual([
      policyArn,
    ]);

    // 4. Group: members and policy attachments.
    await createGroup(groupName);
    await attachPolicy('group', groupName, policyArn);
    expect(
      (await listAttachedPolicies('group', groupName)).map((entry) => entry.policyArn),
    ).toEqual([policyArn]);

    // 5. User: tags, access key lifecycle, group membership.
    const createdUser = await createUser({ userName, tags: [{ Key: 'env', Value: 'live-test' }] });
    expect(createdUser.tags).toEqual([{ Key: 'env', Value: 'live-test' }]);
    expect((await getUser(userName)).userName).toBe(userName);

    await putUserTags({
      userName,
      tags: [
        { Key: 'env', Value: 'production' },
        { Key: 'owner', Value: 'platform' },
      ],
    });
    expect((await listUserTags(userName)).map((tag) => tag.Key).sort()).toEqual(['env', 'owner']);

    const key = await createAccessKey(userName);
    expect(key.secretAccessKey.length).toBeGreaterThan(0);
    expect((await listAccessKeys(userName)).map((entry) => entry.accessKeyId)).toContain(
      key.accessKeyId,
    );

    await updateAccessKey({ userName, accessKeyId: key.accessKeyId, active: false });
    expect((await listAccessKeys(userName))[0]?.status).toBe('Inactive');
    await updateAccessKey({ userName, accessKeyId: key.accessKeyId, active: true });
    expect((await listAccessKeys(userName))[0]?.status).toBe('Active');

    await addUserToGroup({ userName, groupName });
    expect((await getGroup(groupName)).users.map((user) => user.userName)).toEqual([userName]);
    expect((await listGroupsForUser(userName)).map((group) => group.groupName)).toEqual([
      groupName,
    ]);

    // 6. The policy knows every entity it is attached to.
    const entities = await listEntitiesForPolicy(policyArn);
    expect(entities.users).toEqual([]);
    expect(entities.groups.map((entry) => entry.name)).toEqual([groupName]);
    expect(entities.roles.map((entry) => entry.name)).toEqual([roleName]);

    // 7. The dashboard counts include everything created above.
    expect((await listAllUsers()).map((user) => user.userName)).toContain(userName);
    expect((await listAllGroups()).map((group) => group.groupName)).toContain(groupName);
    expect((await listAllRoles()).map((role) => role.roleName)).toContain(roleName);
    expect((await listAllPolicies('Local')).map((policy) => policy.policyName)).toContain(
      policyName,
    );

    // 8. IAM refuses deletions while references remain; the console maps those
    //    to its DeleteConflict wording instead of a 5xx.
    await expect(deleteUser(userName)).rejects.toSatisfy((caught: unknown) =>
      isIamCode(caught, 'DeleteConflict'),
    );
    await deleteAccessKey({ userName, accessKeyId: key.accessKeyId });
    expect(await listAccessKeys(userName)).toEqual([]);

    await expect(deleteGroup(groupName)).rejects.toSatisfy((caught: unknown) =>
      isIamCode(caught, 'DeleteConflict'),
    );
    await expect(deleteRole(roleName)).rejects.toSatisfy((caught: unknown) =>
      isIamCode(caught, 'DeleteConflict'),
    );
    await expect(deletePolicy(policyArn)).rejects.toSatisfy((caught: unknown) =>
      isIamCode(caught, 'DeleteConflict'),
    );

    // 9. Unwind in dependency order, the way the console flows do.
    await removeUserFromGroup({ userName, groupName });
    await deleteUser(userName);
    expect((await listAllUsers()).map((user) => user.userName)).not.toContain(userName);

    await detachPolicy('group', groupName, policyArn);
    await deleteGroup(groupName);
    expect((await listAllGroups()).map((group) => group.groupName)).not.toContain(groupName);

    await detachPolicy('role', roleName, policyArn);
    await deleteRole(roleName);
    expect((await listAllRoles()).map((role) => role.roleName)).not.toContain(roleName);

    await deletePolicy(policyArn);
    expect((await listAllPolicies('Local')).map((policy) => policy.policyName)).not.toContain(
      policyName,
    );
  }, 60_000);
});
