import type { EmulatorProviderId } from './types.js';

/**
 * Provider health keys that do not match LocalDeck's canonical registry id.
 *
 * The registry uses LocalStack's service-key vocabulary (plus a few LocalDeck
 * ids). MiniStack and Floci use their own keys for several services; mapping
 * them here keeps the 114-entry catalogue untouched and makes the sidebar
 * correct for every provider.
 */
export const HEALTH_KEY_ALIASES: Readonly<
  Record<EmulatorProviderId, Readonly<Record<string, string>>>
> = {
  // LocalStack keys are already the registry vocabulary; per-service
  // `healthKeys` cover the few historical aliases.
  localstack: {},

  floci: {
    monitoring: 'cloudwatch',
    email: 'ses',
    states: 'stepfunctions',
    es: 'opensearch',
    events: 'eventbridge',
    kafka: 'msk',
    amazonmq: 'mq',
    elasticloadbalancing: 'elbv2',
    elasticmapreduce: 'emr',
    kinesisanalytics: 'kinesisanalyticsv2',
    tagging: 'resourcegroupstaggingapi',
    'service-catalog': 'servicecatalog',
    cloudcontrolapi: 'cloudcontrol',
    apigatewayv2: 'apigateway',
    appconfigdata: 'appconfig',
    'bedrock-runtime': 'bedrock',
    'bedrock-agentcore': 'bedrock',
    'bedrock-agentcore-control': 'bedrock',
    inspector2: 'inspector',
    sso: 'sso-admin',
    'sso-oidc': 'sso-admin',
    ec2messages: 'ssm',
  },

  ministack: {
    elasticfilesystem: 'efs',
    elasticloadbalancing: 'elbv2',
    elasticmapreduce: 'emr',
    events: 'eventbridge',
    monitoring: 'cloudwatch',
    states: 'stepfunctions',
    es: 'opensearch',
    airflow: 'mwaa',
    kafka: 'msk',
    tagging: 'resourcegroupstaggingapi',
    inspector2: 'inspector',
    'lambda-core': 'lambda',
    'lambda-microvms': 'lambda',
    'bedrock-runtime': 'bedrock',
    'bedrock-agent': 'bedrock',
    'bedrock-agent-runtime': 'bedrock',
    'bedrock-agentcore': 'bedrock',
    'iot-jobs-data': 'iot',
  },

  // No aliases: the generic fallback has no service inventory to map.
  generic: {},
};

/** Maps one provider health key onto LocalDeck's canonical service id. */
export function canonicalServiceId(provider: EmulatorProviderId, providerKey: string): string {
  return HEALTH_KEY_ALIASES[provider][providerKey] ?? providerKey;
}

function buildReverseAliases(
  providerId: EmulatorProviderId,
): Readonly<Record<string, readonly string[]>> {
  const reverse: Record<string, string[]> = {};
  for (const [providerKey, canonicalId] of Object.entries(HEALTH_KEY_ALIASES[providerId])) {
    (reverse[canonicalId] ??= []).push(providerKey);
  }
  return reverse;
}

const REVERSE_ALIASES: Readonly<
  Record<EmulatorProviderId, Readonly<Record<string, readonly string[]>>>
> = {
  localstack: buildReverseAliases('localstack'),
  floci: buildReverseAliases('floci'),
  ministack: buildReverseAliases('ministack'),
  generic: buildReverseAliases('generic'),
};

/** Provider health keys that can carry the state of a canonical service. */
export function providerKeysForCanonical(
  provider: EmulatorProviderId,
  canonicalId: string,
): readonly string[] {
  return REVERSE_ALIASES[provider][canonicalId] ?? [];
}
