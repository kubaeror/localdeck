import { parseJson } from '../../lib/json';

/**
 * IAM policy document validation and construction.
 *
 * The JsonEditor already rejects malformed JSON; this module adds the policy
 * structure checks the console performs on top. Identity policies (the
 * documents `CreatePolicy`/`CreatePolicyVersion` accept) require a Version and
 * at least one Statement, and every statement needs an Effect, an Action and a
 * Resource. Trust policies (`CreateRole`/`UpdateAssumeRolePolicy`) require a
 * Principal instead of a Resource. LocalStack answers a raw 400
 * (`MalformedPolicyDocument`) for documents that fail these checks, so catching
 * the common mistakes inline keeps the failure friendly.
 */

export interface IamPolicyValidation {
  /** `null` when the text parses as JSON; otherwise the parse error. */
  jsonError: string | null;
  /** Structural problems, in statement order. Empty when every check passes. */
  structureErrors: readonly string[];
  /** True when the document is valid JSON and passes every structural check. */
  valid: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A policy field may be a single string or an array of strings. */
function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) {
    return (
      value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0)
    );
  }
  return false;
}

const EFFECTS = new Set(['Allow', 'Deny']);

interface StatementCheck {
  errors: readonly string[];
}

/** Checked against the rules of `kind`; identity policies forbid Principal. */
function checkStatement(
  statement: unknown,
  index: number,
  kind: 'identity' | 'trust',
): StatementCheck {
  const where = `Statement[${index}]`;
  const errors: string[] = [];

  if (!isRecord(statement)) {
    return { errors: [`${where} must be a JSON object.`] };
  }

  const sid = statement['Sid'];
  if (sid !== undefined && typeof sid !== 'string') {
    errors.push(`${where} "Sid" must be a string.`);
  }

  const effect = statement['Effect'];
  if (effect === undefined) errors.push(`${where} is missing "Effect".`);
  else if (typeof effect !== 'string' || !EFFECTS.has(effect)) {
    errors.push(`${where} "Effect" must be "Allow" or "Deny".`);
  }

  const principal = statement['Principal'];
  const notPrincipal = statement['NotPrincipal'];
  if (kind === 'trust') {
    if (principal === undefined && notPrincipal === undefined) {
      errors.push(
        `${where} is missing "Principal" (trust policies must name who can assume the role).`,
      );
    }
  } else if (principal !== undefined || notPrincipal !== undefined) {
    errors.push(
      `${where} must not include "${principal !== undefined ? 'Principal' : 'NotPrincipal'}" (identity policies grant permissions to no one in particular).`,
    );
  }

  const action = statement['Action'];
  const notAction = statement['NotAction'];
  if (action === undefined && notAction === undefined) {
    errors.push(`${where} is missing "Action".`);
  } else if (action !== undefined && !isStringOrStringArray(action)) {
    errors.push(`${where} "Action" must be a string or an array of strings.`);
  } else if (notAction !== undefined && !isStringOrStringArray(notAction)) {
    errors.push(`${where} "NotAction" must be a string or an array of strings.`);
  }

  if (kind === 'identity') {
    const resource = statement['Resource'];
    const notResource = statement['NotResource'];
    if (resource === undefined && notResource === undefined) {
      errors.push(`${where} is missing "Resource".`);
    } else if (resource !== undefined && !isStringOrStringArray(resource)) {
      errors.push(`${where} "Resource" must be a string or an array of strings.`);
    } else if (notResource !== undefined && !isStringOrStringArray(notResource)) {
      errors.push(`${where} "NotResource" must be a string or an array of strings.`);
    }
  }

  const condition = statement['Condition'];
  if (condition !== undefined && !isRecord(condition)) {
    errors.push(`${where} "Condition" must be a JSON object.`);
  }

  return { errors };
}

function validateDocument(text: string, kind: 'identity' | 'trust'): IamPolicyValidation {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return { jsonError: parsed.error, structureErrors: [], valid: false };
  }

  if (!isRecord(parsed.value)) {
    return {
      jsonError: null,
      structureErrors: ['The policy document must be a JSON object.'],
      valid: false,
    };
  }

  const errors: string[] = [];
  const policy = parsed.value;

  const version = policy['Version'];
  if (version === undefined) {
    errors.push('The policy is missing "Version" (use "2012-10-17").');
  } else if (typeof version !== 'string' || version.length === 0) {
    errors.push('"Version" must be a string, for example "2012-10-17".');
  }

  const statement = policy['Statement'];
  if (statement === undefined) {
    errors.push('The policy is missing "Statement".');
  } else if (!Array.isArray(statement) && !isRecord(statement)) {
    errors.push('"Statement" must be an object or an array of objects.');
  } else if (Array.isArray(statement) && statement.length === 0) {
    errors.push('"Statement" must contain at least one statement.');
  }

  const statements =
    statement === undefined
      ? []
      : Array.isArray(statement)
        ? statement
        : isRecord(statement)
          ? [statement]
          : [];
  statements.forEach((entry, index) => {
    errors.push(...checkStatement(entry, index, kind).errors);
  });

  return { jsonError: null, structureErrors: errors, valid: errors.length === 0 };
}

/** Validates an identity-based policy document (Version + Statement + ...). */
export function validateIdentityPolicy(text: string): IamPolicyValidation {
  return validateDocument(text, 'identity');
}

/** Validates a role trust policy document (Version + Statement + Principal). */
export function validateTrustPolicy(text: string): IamPolicyValidation {
  return validateDocument(text, 'trust');
}

// -------------------------------------------------------------- visual editor

/** The single statement the step-based editor represents. */
export interface PolicyStatementDraft {
  effect: 'Allow' | 'Deny';
  /** Action ids, e.g. `s3:GetObject`. */
  actions: readonly string[];
  /** Resource ARNs, e.g. `arn:aws:s3:::my-bucket/*` or `*`. */
  resources: readonly string[];
}

/** One selectable API action in the step-based editor. */
export interface IamActionOption {
  value: string;
  label: string;
}

/** One AWS service and the actions the editor offers for it. */
export interface IamActionService {
  value: string;
  label: string;
  actions: readonly IamActionOption[];
}

/** The services the step-based editor can build statements for. */
export const IAM_ACTION_CATALOG: readonly IamActionService[] = [
  {
    value: 's3',
    label: 'S3',
    actions: [
      { value: 's3:ListBucket', label: 'ListBucket' },
      { value: 's3:GetObject', label: 'GetObject' },
      { value: 's3:PutObject', label: 'PutObject' },
      { value: 's3:DeleteObject', label: 'DeleteObject' },
      { value: 's3:GetBucketLocation', label: 'GetBucketLocation' },
    ],
  },
  {
    value: 'lambda',
    label: 'Lambda',
    actions: [
      { value: 'lambda:InvokeFunction', label: 'InvokeFunction' },
      { value: 'lambda:ListFunctions', label: 'ListFunctions' },
      { value: 'lambda:GetFunction', label: 'GetFunction' },
      { value: 'lambda:CreateFunction', label: 'CreateFunction' },
      { value: 'lambda:UpdateFunctionCode', label: 'UpdateFunctionCode' },
      { value: 'lambda:DeleteFunction', label: 'DeleteFunction' },
    ],
  },
  {
    value: 'dynamodb',
    label: 'DynamoDB',
    actions: [
      { value: 'dynamodb:GetItem', label: 'GetItem' },
      { value: 'dynamodb:PutItem', label: 'PutItem' },
      { value: 'dynamodb:UpdateItem', label: 'UpdateItem' },
      { value: 'dynamodb:DeleteItem', label: 'DeleteItem' },
      { value: 'dynamodb:Query', label: 'Query' },
      { value: 'dynamodb:Scan', label: 'Scan' },
      { value: 'dynamodb:ListTables', label: 'ListTables' },
    ],
  },
  {
    value: 'sqs',
    label: 'SQS',
    actions: [
      { value: 'sqs:SendMessage', label: 'SendMessage' },
      { value: 'sqs:ReceiveMessage', label: 'ReceiveMessage' },
      { value: 'sqs:DeleteMessage', label: 'DeleteMessage' },
      { value: 'sqs:GetQueueAttributes', label: 'GetQueueAttributes' },
      { value: 'sqs:ListQueues', label: 'ListQueues' },
    ],
  },
  {
    value: 'sns',
    label: 'SNS',
    actions: [
      { value: 'sns:Publish', label: 'Publish' },
      { value: 'sns:Subscribe', label: 'Subscribe' },
      { value: 'sns:ListTopics', label: 'ListTopics' },
      { value: 'sns:CreateTopic', label: 'CreateTopic' },
      { value: 'sns:DeleteTopic', label: 'DeleteTopic' },
    ],
  },
  {
    value: 'logs',
    label: 'CloudWatch Logs',
    actions: [
      { value: 'logs:CreateLogGroup', label: 'CreateLogGroup' },
      { value: 'logs:CreateLogStream', label: 'CreateLogStream' },
      { value: 'logs:PutLogEvents', label: 'PutLogEvents' },
      { value: 'logs:GetLogEvents', label: 'GetLogEvents' },
      { value: 'logs:DescribeLogGroups', label: 'DescribeLogGroups' },
    ],
  },
  {
    value: 'ec2',
    label: 'EC2',
    actions: [
      { value: 'ec2:DescribeInstances', label: 'DescribeInstances' },
      { value: 'ec2:StartInstances', label: 'StartInstances' },
      { value: 'ec2:StopInstances', label: 'StopInstances' },
      { value: 'ec2:RunInstances', label: 'RunInstances' },
      { value: 'ec2:TerminateInstances', label: 'TerminateInstances' },
      { value: 'ec2:DescribeSecurityGroups', label: 'DescribeSecurityGroups' },
    ],
  },
  {
    value: 'iam',
    label: 'IAM',
    actions: [
      { value: 'iam:GetUser', label: 'GetUser' },
      { value: 'iam:ListUsers', label: 'ListUsers' },
      { value: 'iam:CreateUser', label: 'CreateUser' },
      { value: 'iam:ListRoles', label: 'ListRoles' },
      { value: 'iam:PassRole', label: 'PassRole' },
    ],
  },
  {
    value: 'kms',
    label: 'KMS',
    actions: [
      { value: 'kms:Encrypt', label: 'Encrypt' },
      { value: 'kms:Decrypt', label: 'Decrypt' },
      { value: 'kms:GenerateDataKey', label: 'GenerateDataKey' },
      { value: 'kms:DescribeKey', label: 'DescribeKey' },
    ],
  },
  {
    value: 'secretsmanager',
    label: 'Secrets Manager',
    actions: [
      { value: 'secretsmanager:GetSecretValue', label: 'GetSecretValue' },
      { value: 'secretsmanager:PutSecretValue', label: 'PutSecretValue' },
      { value: 'secretsmanager:CreateSecret', label: 'CreateSecret' },
      { value: 'secretsmanager:DescribeSecret', label: 'DescribeSecret' },
    ],
  },
];

/** Serializes a visual-editor draft into an identity policy document. */
export function buildIdentityPolicyText(draft: PolicyStatementDraft): string {
  const actions = draft.actions.length === 1 ? draft.actions[0] : [...draft.actions];
  const resources = draft.resources.length === 1 ? draft.resources[0] : [...draft.resources];
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [{ Effect: draft.effect, Action: actions, Resource: resources }],
    },
    null,
    2,
  );
}

/**
 * Reads a document back into the visual-editor draft. Returns `null` when the
 * document uses anything the visual editor cannot represent (several
 * statements, NotAction/NotResource, conditions, a Sid, a missing Version), so
 * the caller keeps the user in the JSON tab instead of silently dropping data.
 */
export function readPolicyStatement(text: string): PolicyStatementDraft | null {
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) return null;

  const policy = parsed.value;
  if (typeof policy['Version'] !== 'string') return null;

  const statement = policy['Statement'];
  const statements = Array.isArray(statement) ? statement : [statement];
  if (statements.length !== 1 || !isRecord(statements[0])) return null;

  const entry = statements[0];
  const allowedKeys = new Set(['Effect', 'Action', 'Resource']);
  if (Object.keys(entry).some((key) => !allowedKeys.has(key))) return null;

  const effect = entry['Effect'];
  if (effect !== 'Allow' && effect !== 'Deny') return null;

  const actions =
    typeof entry['Action'] === 'string'
      ? [entry['Action']]
      : Array.isArray(entry['Action']) &&
          entry['Action'].every((value) => typeof value === 'string')
        ? (entry['Action'] as string[])
        : null;
  const resources =
    typeof entry['Resource'] === 'string'
      ? [entry['Resource']]
      : Array.isArray(entry['Resource']) &&
          entry['Resource'].every((value) => typeof value === 'string')
        ? (entry['Resource'] as string[])
        : null;
  if (actions === null || resources === null) return null;

  return { effect, actions, resources };
}

// ------------------------------------------------------------- trust policies

/** AWS service principals the create-role wizard offers, in console wording. */
export const TRUSTED_SERVICE_PRINCIPALS = [
  { value: 'lambda.amazonaws.com', label: 'Lambda' },
  { value: 'ec2.amazonaws.com', label: 'EC2' },
  { value: 'ecs-tasks.amazonaws.com', label: 'ECS tasks' },
  { value: 'ecs.amazonaws.com', label: 'ECS' },
  { value: 'eks.amazonaws.com', label: 'EKS' },
  { value: 'states.amazonaws.com', label: 'Step Functions' },
  { value: 's3.amazonaws.com', label: 'S3' },
  { value: 'glue.amazonaws.com', label: 'Glue' },
  { value: 'codebuild.amazonaws.com', label: 'CodeBuild' },
  { value: 'events.amazonaws.com', label: 'EventBridge' },
  { value: 'scheduler.amazonaws.com', label: 'EventBridge Scheduler' },
  { value: 'apigateway.amazonaws.com', label: 'API Gateway' },
  { value: 'autoscaling.amazonaws.com', label: 'EC2 Auto Scaling' },
  { value: 'edgelambda.amazonaws.com', label: 'Lambda@Edge' },
] as const;

/** Builds the trust policy for one or more AWS service principals. */
export function buildTrustPolicyForService(services: readonly string[]): string {
  const principal =
    services.length === 1 ? (services[0] ?? '') : services.map((service) => service);
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: principal },
          Action: 'sts:AssumeRole',
        },
      ],
    },
    null,
    2,
  );
}

/** Builds the trust policy that lets another AWS account assume the role. */
export function buildTrustPolicyForAccount(accountId: string): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: `arn:aws:iam::${accountId}:root` },
          Action: 'sts:AssumeRole',
        },
      ],
    },
    null,
    2,
  );
}

/**
 * One-line description of who can assume a role, for the roles list. Reads the
 * already-decoded trust policy text; an unreadable policy reports `unknown`.
 */
export function summarizeTrustedEntities(text: string | undefined): string {
  if (text === undefined || text.trim().length === 0) return '—';
  const parsed = parseJson(text);
  if (!parsed.ok || !isRecord(parsed.value)) return 'unknown';

  const statement = parsed.value['Statement'];
  const statements = Array.isArray(statement) ? statement : [statement];
  const entities: string[] = [];

  for (const entry of statements) {
    if (!isRecord(entry)) continue;
    const principal = entry['Principal'];
    if (typeof principal === 'string') entities.push(principal);
    else if (Array.isArray(principal)) {
      for (const value of principal) if (typeof value === 'string') entities.push(value);
    } else if (isRecord(principal)) {
      for (const value of Object.values(principal)) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (typeof item !== 'string') continue;
          const account = /^arn:aws:iam::(\d{12}):root$/.exec(item);
          entities.push(account === null ? item : `account ${account[1]}`);
        }
      }
    }
  }

  const unique = [...new Set(entities)];
  if (unique.length === 0) return '—';
  if (unique.length <= 2) return unique.join(', ');
  return `${unique[0] ?? ''} and ${unique.length - 1} more`;
}

/** The example the empty policy editor starts from, matching the console. */
export const EXAMPLE_POLICY_DOCUMENT = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: ['arn:aws:s3:::my-bucket/*'],
      },
    ],
  },
  null,
  2,
);
