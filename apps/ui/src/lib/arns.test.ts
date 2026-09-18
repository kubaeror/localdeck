import { describe, expect, it } from 'vitest';
import { ARN_SERVICE_ALIASES, parseArn, serviceForArn } from './arns';

describe('parseArn', () => {
  it('splits a plain ARN', () => {
    expect(parseArn('arn:aws:s3:::my-bucket')).toEqual({
      partition: 'aws',
      service: 's3',
      region: '',
      account: '',
      resource: 'my-bucket',
    });
  });

  it('splits resource-type ARNs', () => {
    expect(parseArn('arn:aws:lambda:us-east-1:000000000000:function:my-fn')).toMatchObject({
      service: 'lambda',
      region: 'us-east-1',
      account: '000000000000',
      resourceType: 'function',
      resource: 'my-fn',
    });
  });

  it('keeps colons inside the resource', () => {
    expect(
      parseArn('arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/fn:*'),
    ).toMatchObject({
      resourceType: 'log-group',
      resource: '/aws/lambda/fn:*',
    });
  });

  it('rejects values that are not ARNs', () => {
    expect(parseArn('not-an-arn')).toBeNull();
    expect(parseArn('arn:aws:s3:::')).toBeNull();
    expect(parseArn('arn:aws:s3')).toBeNull();
  });
});

describe('serviceForArn', () => {
  it('maps ARN namespaces onto LocalDeck services', () => {
    const cases: Readonly<Record<string, string>> = {
      'arn:aws:s3:::bucket': 's3',
      'arn:aws:sqs:us-east-1:000000000000:queue': 'sqs',
      'arn:aws:states:us-east-1:000000000000:stateMachine:fn': 'stepfunctions',
      'arn:aws:execute-api:us-east-1:000000000000:api-id/stage': 'apigateway',
      'arn:aws:elasticloadbalancing:us-east-1:000000000000:loadbalancer/app/x': 'elbv2',
      'arn:aws:es:us-east-1:000000000000:domain/x': 'opensearch',
    };

    for (const [arn, expected] of Object.entries(cases)) {
      const parsed = parseArn(arn);
      if (parsed === null) throw new Error(`failed to parse ${arn}`);
      expect(serviceForArn(parsed)?.id, arn).toBe(expected);
    }
  });

  it('returns nothing for services the console does not know', () => {
    const parsed = parseArn('arn:aws:unknown-service:::thing');
    if (parsed === null) throw new Error('failed to parse');
    expect(serviceForArn(parsed)).toBeUndefined();
  });

  it('keeps the alias table small and explicit', () => {
    expect(Object.keys(ARN_SERVICE_ALIASES).length).toBeLessThan(10);
  });
});
