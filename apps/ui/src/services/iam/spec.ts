import { createServiceSpec } from '@localdeck/shared';

/**
 * IAM capability metadata.
 *
 * `operations` must stay a subset of the registry whitelist in
 * `packages/shared/src/services.ts`; `createServiceSpec` throws at module load
 * otherwise, and the api rejects anything else with 400 before the SDK runs.
 *
 * Every operation here was exercised against the running LocalStack before it
 * was whitelisted (see `live-localstack-iam.test.ts` for the console-side
 * acceptance flow).
 */
export const spec = createServiceSpec('iam', {
  operations: [
    // Users
    'ListUsers',
    'CreateUser',
    'GetUser',
    'DeleteUser',
    'ListUserTags',
    'TagUser',
    'UntagUser',
    // Access keys
    'ListAccessKeys',
    'CreateAccessKey',
    'UpdateAccessKey',
    'DeleteAccessKey',
    // Groups
    'ListGroups',
    'CreateGroup',
    'GetGroup',
    'DeleteGroup',
    'AddUserToGroup',
    'RemoveUserFromGroup',
    'ListGroupsForUser',
    // Roles
    'ListRoles',
    'CreateRole',
    'GetRole',
    'DeleteRole',
    'UpdateAssumeRolePolicy',
    'ListRoleTags',
    'TagRole',
    'UntagRole',
    // Policies
    'ListPolicies',
    'CreatePolicy',
    'GetPolicy',
    'DeletePolicy',
    'GetPolicyVersion',
    'CreatePolicyVersion',
    'ListEntitiesForPolicy',
    // Attached policies
    'ListAttachedUserPolicies',
    'AttachUserPolicy',
    'DetachUserPolicy',
    'ListAttachedGroupPolicies',
    'AttachGroupPolicy',
    'DetachGroupPolicy',
    'ListAttachedRolePolicies',
    'AttachRolePolicy',
    'DetachRolePolicy',
  ],
  capabilities: { list: true, detail: true, create: true },
});

export const SERVICE_ID = spec.descriptor.id;
