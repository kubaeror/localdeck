import type { ServiceBrowserListOperation } from '@localdeck/shared';
import { describe, expect, it } from 'vitest';
import { browserOperationInput, mapListResult, nextTokenFromResult } from './api';

const LIST: ServiceBrowserListOperation = { operation: 'ListTopics' };

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
