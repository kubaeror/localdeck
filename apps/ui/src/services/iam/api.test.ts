// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachPolicy,
  createAccessKey,
  decodePolicyDocument,
  getPolicyDocument,
  getUser,
  listAccessKeys,
  listAttachedPolicies,
  listEntitiesForPolicy,
  listPolicies,
  listRoles,
  listUsers,
  putUserTags,
} from './api';

type Handler = (operation: string, input: Record<string, unknown>) => unknown;

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

/** Answers the api dispatcher as the Fastify route would, recording calls. */
function stubDispatcher(handler: Handler): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/iam\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });

    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });

    const result = handler(operation, operationInput);
    if (typeof result === 'object' && result !== null && '__error' in result) {
      const error = (result as { __error: { code: string; message: string; statusCode: number } })
        .__error;
      return new Response(JSON.stringify({ error }), {
        status: error.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service: 'iam', operation, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function operationInput(calls: readonly Call[], operation: string): Record<string, unknown> {
  const call = calls.find((entry) => entry.operation === operation);
  if (call === undefined) throw new Error(`${operation} was not called`);
  return call.input;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodePolicyDocument', () => {
  it('decodes LocalStack percent-encoded documents', () => {
    expect(decodePolicyDocument('%7B%22Version%22%3A%222012-10-17%22%7D')).toBe(
      '{"Version":"2012-10-17"}',
    );
  });

  it('passes plain JSON and parsed objects through', () => {
    expect(decodePolicyDocument('{"a":1}')).toBe('{"a":1}');
    expect(decodePolicyDocument({ Version: '2012-10-17' })).toBe('{"Version":"2012-10-17"}');
    expect(decodePolicyDocument(undefined)).toBeUndefined();
  });

  it('returns the raw value when decoding fails', () => {
    expect(decodePolicyDocument('%')).toBe('%');
  });
});

describe('listUsers', () => {
  it('maps users and turns the marker into a continuation token', async () => {
    const calls = stubDispatcher(() => ({
      Users: [
        {
          UserName: 'alice',
          Arn: 'arn:aws:iam::000000000000:user/alice',
          CreateDate: '2026-01-02T03:04:05.000Z',
          Tags: [{ Key: 'team', Value: 'core' }],
        },
        { UserName: 'bob' },
      ],
      IsTruncated: true,
      Marker: 'page-2',
    }));

    const page = await listUsers({ nextToken: 'page-1' });

    expect(operationInput(calls, 'ListUsers')).toMatchObject({ Marker: 'page-1', MaxItems: 100 });
    expect(page.items.map((user) => user.userName)).toEqual(['alice', 'bob']);
    expect(page.items[0]).toMatchObject({
      arn: 'arn:aws:iam::000000000000:user/alice',
      createDate: '2026-01-02T03:04:05.000Z',
      tags: [{ Key: 'team', Value: 'core' }],
    });
    // The default ARN covers LocalStack responses that omit it.
    expect(page.items[1]?.arn).toBe('arn:aws:iam::000000000000:user/bob');
    expect(page.nextToken).toBe('page-2');
  });

  it('drops entries without a name and omits the token when not truncated', async () => {
    stubDispatcher(() => ({ Users: [{ UserId: 'no-name' }, { UserName: 'carol' }] }));

    const page = await listUsers();

    expect(page.items.map((user) => user.userName)).toEqual(['carol']);
    expect(page.nextToken).toBeUndefined();
  });
});

describe('getUser', () => {
  it('returns the user with its tags', async () => {
    stubDispatcher(() => ({
      User: { UserName: 'alice', Tags: [{ Key: 'env', Value: 'local' }] },
    }));

    const user = await getUser('alice');

    expect(user.userName).toBe('alice');
    expect(user.tags).toEqual([{ Key: 'env', Value: 'local' }]);
  });

  it('throws when LocalStack returns no user', async () => {
    stubDispatcher(() => ({}));

    await expect(getUser('missing')).rejects.toThrow('LocalStack returned no user');
  });
});

describe('putUserTags', () => {
  it('sends only changed keys to TagUser and removed keys to UntagUser', async () => {
    const calls = stubDispatcher((operation) =>
      operation === 'ListUserTags'
        ? {
            Tags: [
              { Key: 'keep', Value: '1' },
              { Key: 'drop', Value: 'x' },
              { Key: 'edit', Value: 'old' },
            ],
          }
        : {},
    );

    await putUserTags({
      userName: 'alice',
      tags: [
        { Key: 'keep', Value: '1' },
        { Key: 'edit', Value: 'new' },
        { Key: 'added', Value: '' },
      ],
    });

    expect(operationInput(calls, 'TagUser')).toEqual({
      UserName: 'alice',
      Tags: [
        { Key: 'edit', Value: 'new' },
        { Key: 'added', Value: '' },
      ],
    });
    expect(operationInput(calls, 'UntagUser')).toEqual({ UserName: 'alice', TagKeys: ['drop'] });
  });

  it('makes no write calls when nothing changed', async () => {
    const calls = stubDispatcher(() => ({ Tags: [{ Key: 'keep', Value: '1' }] }));

    await putUserTags({ userName: 'alice', tags: [{ Key: 'keep', Value: '1' }] });

    expect(calls.map((call) => call.operation)).toEqual(['ListUserTags']);
  });
});

describe('access keys', () => {
  it('lists key metadata without the secret', async () => {
    stubDispatcher(() => ({
      AccessKeyMetadata: [
        {
          AccessKeyId: 'AKIA1',
          UserName: 'alice',
          Status: 'Active',
          CreateDate: '2026-01-01T00:00:00.000Z',
        },
      ],
    }));

    const keys = await listAccessKeys('alice');

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ accessKeyId: 'AKIA1', status: 'Active' });
  });

  it('returns the secret exactly when a key is created', async () => {
    stubDispatcher(() => ({
      AccessKey: {
        AccessKeyId: 'AKIA2',
        SecretAccessKey: 'secret',
        Status: 'Active',
        UserName: 'alice',
      },
    }));

    const key = await createAccessKey('alice');

    expect(key).toEqual({
      accessKeyId: 'AKIA2',
      secretAccessKey: 'secret',
      status: 'Active',
      userName: 'alice',
    });
  });

  it('fails when the create response has no secret', async () => {
    stubDispatcher(() => ({ AccessKey: { AccessKeyId: 'AKIA3' } }));

    await expect(createAccessKey('alice')).rejects.toThrow('LocalStack returned no access key');
  });
});

describe('roles and policies', () => {
  it('decodes a role trust policy returned percent-encoded', async () => {
    const encoded = encodeURIComponent(JSON.stringify({ Version: '2012-10-17', Statement: [] }));
    stubDispatcher(() => ({
      Roles: [{ RoleName: 'lambda-role', AssumeRolePolicyDocument: encoded }],
    }));

    const page = await listRoles();

    expect(page.items[0]?.assumeRolePolicyDocument).toContain('"Version":"2012-10-17"');
  });

  it('passes the requested scope to ListPolicies and maps the attachment count', async () => {
    const calls = stubDispatcher(() => ({
      Policies: [
        {
          PolicyName: 'read-only',
          Arn: 'arn:aws:iam::000000000000:policy/read-only',
          DefaultVersionId: 'v1',
          AttachmentCount: 3,
          IsAttachable: true,
        },
      ],
    }));

    const page = await listPolicies({ scope: 'Local' });

    expect(operationInput(calls, 'ListPolicies')).toMatchObject({ Scope: 'Local' });
    expect(page.items[0]).toMatchObject({
      policyName: 'read-only',
      attachmentCount: 3,
      scope: 'Local',
    });
  });

  it('decodes a policy version document', async () => {
    const encoded = encodeURIComponent('{"Version":"2012-10-17","Statement":[]}');
    stubDispatcher((operation) =>
      operation === 'GetPolicyVersion' ? { PolicyVersion: { Document: encoded } } : {},
    );

    const document = await getPolicyDocument({ policyArn: 'arn:policy', versionId: 'v1' });

    expect(document).toContain('"Statement"');
  });

  it('resolves the default version when none is given (LocalStack requires one)', async () => {
    const calls = stubDispatcher((operation) =>
      operation === 'GetPolicy'
        ? { Policy: { PolicyName: 'p', Arn: 'arn:policy', DefaultVersionId: 'v2' } }
        : { PolicyVersion: { Document: '{"Version":"2012-10-17","Statement":[]}' } },
    );

    await getPolicyDocument({ policyArn: 'arn:policy' });

    expect(operationInput(calls, 'GetPolicyVersion')).toEqual({
      PolicyArn: 'arn:policy',
      VersionId: 'v2',
    });
  });

  it('maps the entities a policy is attached to', async () => {
    stubDispatcher(() => ({
      PolicyUsers: [{ UserName: 'alice', UserId: 'AIDA1' }],
      PolicyGroups: [{ GroupName: 'devs', GroupId: 'AGPA1' }],
      PolicyRoles: [{ RoleName: 'lambda-role', RoleId: 'AROA1' }],
    }));

    const entities = await listEntitiesForPolicy('arn:policy');

    expect(entities.users).toEqual([{ name: 'alice', id: 'AIDA1' }]);
    expect(entities.groups).toEqual([{ name: 'devs', id: 'AGPA1' }]);
    expect(entities.roles).toEqual([{ name: 'lambda-role', id: 'AROA1' }]);
  });
});

describe('attached policies', () => {
  it('uses the entity-specific operations and input field', async () => {
    const calls = stubDispatcher((operation) =>
      operation.startsWith('ListAttached')
        ? {
            AttachedPolicies: [
              { PolicyName: 'ReadOnlyAccess', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' },
            ],
          }
        : {},
    );

    const attached = await listAttachedPolicies('role', 'lambda-role');
    await attachPolicy('role', 'lambda-role', 'arn:aws:iam::aws:policy/ReadOnlyAccess');
    await attachPolicy('group', 'devs', 'arn:aws:iam::aws:policy/ReadOnlyAccess');

    expect(operationInput(calls, 'ListAttachedRolePolicies')).toEqual({ RoleName: 'lambda-role' });
    expect(operationInput(calls, 'AttachRolePolicy')).toEqual({
      RoleName: 'lambda-role',
      PolicyArn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
    });
    expect(calls.some((call) => call.operation === 'AttachGroupPolicy')).toBe(true);
    expect(attached[0]).toMatchObject({ policyName: 'ReadOnlyAccess', scope: 'AWS' });
  });
});
