import type {
  ServiceBrowserListOperation,
  ServiceBrowserOperation,
  ServiceBrowserTagsOperation,
  ServiceDescriptor,
} from '@localdeck/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/apiClient';
import {
  browserOperationInput,
  describeGenericResource,
  listGenericResources,
  loadGenericResourceTags,
  mapListResult,
  nextPageFromResult,
  nextTokenFromResult,
} from './api';

const LIST: ServiceBrowserListOperation = { operation: 'ListTopics' };

/** Minimal descriptor for one list binding; ids stay unique between tests. */
function descriptorWithList(
  id: string,
  list: ServiceBrowserListOperation,
  describeOperation?: ServiceBrowserOperation,
  tagsOperation?: ServiceBrowserTagsOperation,
): ServiceDescriptor {
  return {
    id,
    displayName: id,
    category: 'Database',
    sdkPackage: '@aws-sdk/client-test',
    iconKey: id,
    operations: [
      list.operation,
      ...(describeOperation === undefined ? [] : [describeOperation.operation]),
      ...(tagsOperation === undefined ? [] : [tagsOperation.operation]),
    ],
    parityLevel: 'browser',
    summary: 'test',
    browser: {
      list,
      ...(describeOperation === undefined ? {} : { describe: describeOperation }),
      ...(tagsOperation === undefined ? {} : { tags: { ...tagsOperation } }),
    },
  };
}

interface DispatchedCall {
  service: string;
  operation: string;
  input: Record<string, unknown>;
}

/** Answers the dispatcher with one result per service/operation. */
function stubOperations(
  results: Readonly<Record<string, unknown | ((input: Record<string, unknown>) => unknown)>>,
): DispatchedCall[] {
  const calls: DispatchedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/([^/?]+)\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const service = match[1] ?? '';
    const operation = match[2] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ service, operation, input: operationInput });
    const configured = results[`${service}/${operation}`];
    const result =
      typeof configured === 'function' ? configured(operationInput) : (configured ?? {});
    return new Response(JSON.stringify({ service, operation, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generic browser response mapping', () => {
  it('maps record collections with the registry id/name hints', () => {
    const result = {
      Topics: [
        { TopicArn: 'arn:aws:sns:us-east-1:000000000000:alpha' },
        { TopicArn: 'arn:aws:sns:us-east-1:000000000000:beta' },
      ],
    };

    const { rows } = mapListResult(result, {
      ...LIST,
      resultPath: 'Topics',
      idField: 'TopicArn',
      nameField: 'TopicArn',
    });

    expect(rows.map((row) => row.id)).toEqual([
      'arn:aws:sns:us-east-1:000000000000:alpha',
      'arn:aws:sns:us-east-1:000000000000:beta',
    ]);
    expect(rows[0]?.label).toBe('arn:aws:sns:us-east-1:000000000000:alpha');
  });

  it('maps string collections and joins multi-field ids', () => {
    const strings = mapListResult({ StreamNames: ['orders', 'events'] }, LIST);
    expect(strings.rows.map((row) => row.id)).toEqual(['orders', 'events']);

    const joined = mapListResult(
      { Metrics: [{ Namespace: 'AWS/SQS', MetricName: 'ApproximateAgeOfOldestMessage' }] },
      {
        ...LIST,
        resultPath: 'Metrics',
        idField: ['Namespace', 'MetricName'],
        nameField: ['Namespace', 'MetricName'],
      },
    );
    expect(joined.rows[0]?.id).toBe('AWS/SQS / ApproximateAgeOfOldestMessage');
  });

  it('follows dotted result paths and the first collection fallback', () => {
    const dotted = mapListResult(
      { DistributionList: { Items: [{ Id: 'E1', DomainName: 'd1.cloudfront.net' }] } },
      {
        ...LIST,
        resultPath: 'DistributionList.Items',
        idField: 'Id',
        nameField: 'DomainName',
      },
    );
    expect(dotted.rows[0]?.label).toBe('d1.cloudfront.net');

    const inferred = mapListResult({ repositories: [{ name: 'api' }] }, LIST);
    expect(inferred.rows[0]?.id).toBe('api');
  });

  it('reads pagination from the registry token or the AWS defaults', () => {
    expect(nextTokenFromResult({ NextToken: 'abc' }, LIST)).toBe('abc');
    expect(nextTokenFromResult({ Marker: 'm1' }, { ...LIST, nextTokenParam: 'Marker' })).toBe('m1');
    expect(nextTokenFromResult({}, LIST)).toBeUndefined();
  });

  it('builds operation inputs with required params and scalar or array ids', () => {
    expect(
      browserOperationInput(
        { operation: 'DescribeClusters', idParam: 'clusters', idParamIsArray: true },
        'arn:aws:ecs:us-east-1:000000000000:cluster/api',
      ),
    ).toEqual({ clusters: ['arn:aws:ecs:us-east-1:000000000000:cluster/api'] });

    expect(
      browserOperationInput(
        {
          operation: 'GetQueueAttributes',
          idParam: 'QueueUrl',
          input: { AttributeNames: ['All'] },
        },
        'http://localhost:4566/000000000000/orders',
      ),
    ).toEqual({
      AttributeNames: ['All'],
      QueueUrl: 'http://localhost:4566/000000000000/orders',
    });
  });
});

describe('generic pagination contracts', () => {
  it('infers the request field from every AWS token family', () => {
    expect(nextPageFromResult({ NextToken: 'n1' }, LIST)).toEqual({
      token: 'n1',
      requestField: 'NextToken',
    });
    expect(nextPageFromResult({ nextToken: 'n2' }, LIST)).toEqual({
      token: 'n2',
      requestField: 'nextToken',
    });
    expect(nextPageFromResult({ ContinuationToken: 'c1' }, LIST)).toEqual({
      token: 'c1',
      requestField: 'ContinuationToken',
    });
    expect(nextPageFromResult({ continuationToken: 'c2' }, LIST)).toEqual({
      token: 'c2',
      requestField: 'continuationToken',
    });
    expect(nextPageFromResult({ NextMarker: 'm-echo' }, LIST)).toEqual({
      token: 'm-echo',
      requestField: 'Marker',
    });
    expect(nextPageFromResult({ Marker: 'm1' }, LIST)).toEqual({
      token: 'm1',
      requestField: 'Marker',
    });
    expect(nextPageFromResult({ LastEvaluatedTableName: 'users' }, LIST)).toEqual({
      token: 'users',
      requestField: 'ExclusiveStartTableName',
    });
    expect(nextPageFromResult({ nextPageToken: 'p1' }, LIST)).toEqual({
      token: 'p1',
      requestField: 'nextPageToken',
    });
    expect(nextPageFromResult({ IsTruncated: true }, LIST)).toBeUndefined();
  });

  it('reads nested tokens such as CloudFront and prefers NextMarker over Marker', () => {
    expect(
      nextPageFromResult(
        { DistributionList: { Items: [], Marker: 'current', NextMarker: 'next' } },
        LIST,
      ),
    ).toEqual({ token: 'next', requestField: 'Marker' });
    expect(nextTokenFromResult({ DistributionList: { NextMarker: 'next' } }, LIST)).toBe('next');
  });

  it('prefers an explicit registry pagination contract, including dotted paths', () => {
    const explicit: ServiceBrowserListOperation = {
      ...LIST,
      pagination: { requestField: 'NextPageToken', responseField: 'Result.NextPageToken' },
    };
    expect(nextPageFromResult({ Result: { NextPageToken: 't1' } }, explicit)).toEqual({
      token: 't1',
      requestField: 'NextPageToken',
    });
  });

  it('sends an inferred Marker token back as Marker on the next page', async () => {
    const descriptor = descriptorWithList('rds-pagination', {
      operation: 'DescribeDBInstances',
      resultPath: 'DBInstances',
      idField: 'DBInstanceIdentifier',
    });
    const calls = stubOperations({
      'rds-pagination/DescribeDBInstances': (input: Record<string, unknown>) =>
        input['Marker'] === undefined
          ? { DBInstances: [{ DBInstanceIdentifier: 'db-1' }], Marker: 'page-2' }
          : { DBInstances: [{ DBInstanceIdentifier: 'db-2' }] },
    });

    const first = await listGenericResources(descriptor);
    expect(first.nextToken).toBe('page-2');
    const second = await listGenericResources(descriptor, { nextToken: 'page-2' });

    expect(calls[1]?.input).toEqual({ Marker: 'page-2' });
    expect(second.items.map((row) => row.id)).toEqual(['db-2']);
    expect(second.nextToken).toBeUndefined();
  });

  it('maps LastEvaluatedTableName onto ExclusiveStartTableName', async () => {
    const descriptor = descriptorWithList('dynamodb-pagination', {
      operation: 'ListTables',
      resultPath: 'TableNames',
    });
    const calls = stubOperations({
      'dynamodb-pagination/ListTables': (input: Record<string, unknown>) =>
        input['ExclusiveStartTableName'] === undefined
          ? { TableNames: ['users'], LastEvaluatedTableName: 'users' }
          : { TableNames: ['orders'] },
    });

    const first = await listGenericResources(descriptor);
    expect(first.nextToken).toBe('users');
    await listGenericResources(descriptor, { nextToken: 'users' });
    expect(calls[1]?.input).toEqual({ ExclusiveStartTableName: 'users' });
  });

  it('reads a nested CloudFront token and sends it as Marker', async () => {
    const descriptor = descriptorWithList('cloudfront-pagination', {
      operation: 'ListDistributions',
      resultPath: 'DistributionList.Items',
      idField: 'Id',
    });
    const calls = stubOperations({
      'cloudfront-pagination/ListDistributions': (input: Record<string, unknown>) =>
        input['Marker'] === undefined
          ? { DistributionList: { Items: [{ Id: 'E1' }], NextMarker: 'dist-2' } }
          : { DistributionList: { Items: [{ Id: 'E2' }] } },
    });

    const first = await listGenericResources(descriptor);
    expect(first.nextToken).toBe('dist-2');
    await listGenericResources(descriptor, { nextToken: 'dist-2' });
    expect(calls[1]?.input).toEqual({ Marker: 'dist-2' });
  });

  it('prefixes fallback row ids with the page key so pages do not collide', () => {
    const list: ServiceBrowserListOperation = { ...LIST, resultPath: 'Items' };
    const first = mapListResult({ Items: [{ size: 1 }] }, list);
    const again = mapListResult({ Items: [{ size: 2 }] }, list);
    const second = mapListResult({ Items: [{ size: 3 }] }, list, { pageKey: 'page-2' });

    // Stable for the same page, unique across pages.
    expect(again.rows[0]?.id).toBe(first.rows[0]?.id);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
  });

  it('keeps fallback row ids unique across pages loaded through Load more', async () => {
    const descriptor = descriptorWithList('fallback-ids', {
      operation: 'ListThings',
      resultPath: 'Items',
    });
    stubOperations({
      'fallback-ids/ListThings': (input: Record<string, unknown>) =>
        input['NextToken'] === undefined
          ? { Items: [{ size: 1 }], NextToken: 'fallback-page-2' }
          : { Items: [{ size: 2 }] },
    });

    const first = await listGenericResources(descriptor);
    const second = await listGenericResources(descriptor, { nextToken: 'fallback-page-2' });

    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  });

  it('stops with a clear error when a listing repeats a pagination token', async () => {
    const descriptor = descriptorWithList('loop-guard', {
      operation: 'ListThings',
      resultPath: 'Items',
      idField: 'Id',
    });
    const calls = stubOperations({
      'loop-guard/ListThings': {
        Items: [{ Id: 'same-row' }],
        NextToken: 'looping-token',
      },
    });

    const first = await listGenericResources(descriptor);
    expect(first.nextToken).toBe('looping-token');

    // The echoed page is served once...
    const echo = await listGenericResources(descriptor, { nextToken: 'looping-token' });
    expect(echo.nextToken).toBe('looping-token');

    // ...and asking for the same token again is refused instead of looping.
    const error = (await listGenericResources(descriptor, {
      nextToken: 'looping-token',
    }).catch((caught: unknown) => caught)) as ApiClientError;
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.apiError.code).toBe('PAGINATION_LOOP');
    expect(error.apiError.message).toContain('looping-token');
    expect(calls).toHaveLength(2);
  });

  it('forgets the seen tokens when a listing restarts from the first page', async () => {
    const descriptor = descriptorWithList('loop-reset', {
      operation: 'ListThings',
      resultPath: 'Items',
      idField: 'Id',
    });
    stubOperations({
      'loop-reset/ListThings': (input: Record<string, unknown>) =>
        input['NextToken'] === undefined
          ? { Items: [{ Id: 'page-1' }], NextToken: 'reused-token' }
          : { Items: [{ Id: 'page-2' }] },
    });

    await listGenericResources(descriptor);
    await listGenericResources(descriptor, { nextToken: 'reused-token' });
    // A refresh starts a new listing; the emulator may hand out the same
    // opaque token, which must not be mistaken for a loop.
    await listGenericResources(descriptor);

    await expect(listGenericResources(descriptor, { nextToken: 'reused-token' })).resolves.toEqual({
      items: [{ id: 'page-2', label: 'page-2', raw: { Id: 'page-2' } }],
    });
  });

  it('uses an explicit requestField for SWF nextPageToken bindings', async () => {
    const descriptor = descriptorWithList('swf-pagination', {
      operation: 'ListDomains',
      resultPath: 'domainInfos',
      pagination: { requestField: 'nextPageToken', responseField: 'nextPageToken' },
    });
    const calls = stubOperations({
      'swf-pagination/ListDomains': (input: Record<string, unknown>) =>
        input['nextPageToken'] === undefined
          ? { domainInfos: [], nextPageToken: 'swf-2' }
          : { domainInfos: [] },
    });

    const first = await listGenericResources(descriptor);
    expect(first.nextToken).toBe('swf-2');
    await listGenericResources(descriptor, { nextToken: 'swf-2' });
    expect(calls[1]?.input).toEqual({ nextPageToken: 'swf-2' });
  });
});

describe('generic batch describes', () => {
  it('unwraps the first item of a batch describe (CodeBuild projects)', async () => {
    const descriptor = descriptorWithList(
      'codebuild-describe',
      { operation: 'ListProjects', resultPath: 'projects' },
      {
        operation: 'BatchGetProjects',
        idParam: 'names',
        idParamIsArray: true,
        resultItemField: 'projects',
      },
    );
    stubOperations({
      'codebuild-describe/BatchGetProjects': {
        projects: [{ name: 'api', description: 'build me' }],
        projectsNotFound: [],
      },
    });

    const described = await describeGenericResource(descriptor, 'api');
    expect(described).toEqual({ name: 'api', description: 'build me' });
  });

  it('falls back to the whole response when the batch item is missing', async () => {
    const descriptor = descriptorWithList(
      'codebuild-missing',
      { operation: 'ListProjects', resultPath: 'projects' },
      {
        operation: 'BatchGetProjects',
        idParam: 'names',
        idParamIsArray: true,
        resultItemField: 'projects',
      },
    );
    stubOperations({
      'codebuild-missing/BatchGetProjects': { projects: [], projectsNotFound: ['missing'] },
    });

    await expect(describeGenericResource(descriptor, 'missing')).resolves.toEqual({
      projects: [],
      projectsNotFound: ['missing'],
    });
  });

  it('names the page cap when the describe fallback walks to the limit', async () => {
    const descriptor = descriptorWithList('describe-cap', {
      operation: 'ListThings',
      resultPath: 'Items',
      idField: 'Id',
    });
    const calls = stubOperations({
      'describe-cap/ListThings': (input: Record<string, unknown>) => ({
        Items: [{ Id: 'other' }],
        NextToken: `token-${String(input['NextToken'] ?? 'start')}`,
      }),
    });

    const error = (await describeGenericResource(descriptor, 'missing', undefined, {
      maxPages: 3,
    }).catch((caught: unknown) => caught)) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.apiError.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.apiError.message).toContain('within the first 3 pages');
    expect(calls).toHaveLength(3);
  });

  it('reports an exhausted listing when the describe fallback runs out of pages', async () => {
    const descriptor = descriptorWithList('describe-exhausted', {
      operation: 'ListThings',
      resultPath: 'Items',
      idField: 'Id',
    });
    stubOperations({
      'describe-exhausted/ListThings': { Items: [{ Id: 'other' }] },
    });

    const error = (await describeGenericResource(descriptor, 'missing').catch(
      (caught: unknown) => caught,
    )) as ApiClientError;

    expect(error.apiError.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.apiError.message).toContain('exhausted after 1 page(s)');
  });
});

describe('generic tags', () => {
  it('distinguishes an unavailable tags read from an empty tag set', async () => {
    const descriptor = descriptorWithList(
      'sns-tags-missing',
      { operation: 'ListTopics', resultPath: 'Topics' },
      undefined,
      { operation: 'ListTagsForResource', idParam: 'ResourceArn' },
    );
    stubOperations({ 'sns-tags-missing/ListTagsForResource': {} });
    await expect(loadGenericResourceTags(descriptor, {}, 'arn')).resolves.toBeUndefined();
  });

  it('returns an empty array when the resource really has no tags', async () => {
    const descriptor = descriptorWithList(
      'sns-tags-empty',
      { operation: 'ListTopics', resultPath: 'Topics' },
      undefined,
      { operation: 'ListTagsForResource', idParam: 'ResourceArn', resultPath: 'Tags' },
    );
    stubOperations({ 'sns-tags-empty/ListTagsForResource': { Tags: [] } });
    await expect(loadGenericResourceTags(descriptor, {}, 'arn')).resolves.toEqual([]);
  });

  it('marks embedded tags unavailable when the describe response has none', async () => {
    const descriptor = descriptorWithList('sns-embedded', {
      operation: 'ListTopics',
      resultPath: 'Topics',
    });
    await expect(loadGenericResourceTags(descriptor, {}, 'arn')).resolves.toBeUndefined();
    await expect(loadGenericResourceTags(descriptor, { Tags: [] }, 'arn')).resolves.toEqual([]);
  });
});
