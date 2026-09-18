import type { ServiceDescriptor } from '@localdeck/shared';
import { findService } from '@localdeck/shared';

export interface ParsedArn {
  partition: string;
  /** AWS service namespace, e.g. `s3`, `sqs`, `execute-api`. */
  service: string;
  region: string;
  account: string;
  resource: string;
  /** Resource type prefix, when the ARN carries one (`function:my-fn`). */
  resourceType?: string;
}

/** Splits `arn:partition:service:region:account:resource` without throwing. */
export function parseArn(arn: string): ParsedArn | null {
  const parts = arn.split(':');
  if (parts.length < 6 || parts[0] !== 'arn') return null;
  const [, partition, service, region, account, ...rest] = parts;
  if (partition === undefined || service === undefined || region === undefined) return null;
  if (account === undefined) return null;
  const resource = rest.join(':');
  if (resource.length === 0) return null;

  const separator = resource.indexOf(':');
  return {
    partition,
    service,
    region,
    account,
    resource,
    ...(separator === -1
      ? {}
      : { resourceType: resource.slice(0, separator), resource: resource.slice(separator + 1) }),
  };
}

/**
 * ARN namespaces that differ from the LocalDeck service id: Step Functions is
 * `states`, API Gateway is `execute-api`, ELB is `elasticloadbalancing`, and
 * OpenSearch still answers to `es`.
 */
export const ARN_SERVICE_ALIASES: Readonly<Record<string, string>> = {
  states: 'stepfunctions',
  'execute-api': 'apigateway',
  elasticloadbalancing: 'elbv2',
  es: 'opensearch',
};

/** The LocalDeck service that owns an ARN, if the console has one. */
export function serviceForArn(parsed: ParsedArn): ServiceDescriptor | undefined {
  return findService(ARN_SERVICE_ALIASES[parsed.service] ?? parsed.service);
}
