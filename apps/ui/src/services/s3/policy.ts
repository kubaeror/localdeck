import { parseJson } from '../../lib/json';

/**
 * Bucket policy validation for the Permissions tab.
 *
 * The JsonEditor already rejects malformed JSON; this module adds the IAM
 * policy structure checks the console performs on top: a Version, a Statement
 * array whose entries each carry an Effect, a Principal, an Action and a
 * Resource. LocalStack answers a raw 400 for structurally invalid documents,
 * so catching the common mistakes inline keeps the failure friendly.
 */

export interface BucketPolicyValidation {
  /** `null` when the text parses as JSON; otherwise the parse error. */
  jsonError: string | null;
  /** Structural problems, in statement order. Empty when every check passes. */
  structureErrors: readonly string[];
  /** True when the document is valid JSON and passes every structural check. */
  valid: boolean;
  /** True when the document allows `Principal: "*"` (the console warning). */
  grantsPublicAccess: boolean;
}

const EFFECTS = new Set(['Allow', 'Deny']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A policy field may be a single string or an array of strings. */
function isStringOrStringArray(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.every((entry) => typeof entry === 'string');
  return false;
}

function principalIsPublic(value: unknown): boolean {
  if (value === '*') return true;
  if (Array.isArray(value)) return value.includes('*');
  return false;
}

interface StatementCheck {
  errors: readonly string[];
  publicAccess: boolean;
}

function checkStatement(statement: unknown, index: number): StatementCheck {
  const where = `Statement[${index}]`;
  const errors: string[] = [];

  if (!isRecord(statement)) {
    return { errors: [`${where} must be a JSON object.`], publicAccess: false };
  }

  const effect = statement['Effect'];
  if (effect === undefined) errors.push(`${where} is missing "Effect".`);
  else if (typeof effect !== 'string' || !EFFECTS.has(effect)) {
    errors.push(`${where} "Effect" must be "Allow" or "Deny".`);
  }

  const principal = statement['Principal'];
  const notPrincipal = statement['NotPrincipal'];
  if (principal === undefined && notPrincipal === undefined) {
    errors.push(`${where} is missing "Principal" (bucket policies must name a principal).`);
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

  const resource = statement['Resource'];
  const notResource = statement['NotResource'];
  if (resource === undefined && notResource === undefined) {
    errors.push(`${where} is missing "Resource".`);
  } else if (resource !== undefined && !isStringOrStringArray(resource)) {
    errors.push(`${where} "Resource" must be a string or an array of strings.`);
  } else if (notResource !== undefined && !isStringOrStringArray(notResource)) {
    errors.push(`${where} "NotResource" must be a string or an array of strings.`);
  }

  const sid = statement['Sid'];
  if (sid !== undefined && typeof sid !== 'string') {
    errors.push(`${where} "Sid" must be a string.`);
  }

  return { errors, publicAccess: effect === 'Allow' && principalIsPublic(principal) };
}

/**
 * Validates a bucket policy document. Never throws: an empty document is
 * reported as a JSON problem so the caller can decide whether empty means
 * "delete the policy" instead of "invalid".
 */
export function validateBucketPolicy(text: string): BucketPolicyValidation {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      jsonError: parsed.error,
      structureErrors: [],
      valid: false,
      grantsPublicAccess: false,
    };
  }

  if (!isRecord(parsed.value)) {
    return {
      jsonError: null,
      structureErrors: ['The policy document must be a JSON object.'],
      valid: false,
      grantsPublicAccess: false,
    };
  }

  const errors: string[] = [];
  const policy = parsed.value;

  const version = policy['Version'];
  if (version !== undefined && typeof version !== 'string') {
    errors.push('"Version" must be a string, for example "2012-10-17".');
  }

  const statement = policy['Statement'];
  const statements =
    statement === undefined ? [] : Array.isArray(statement) ? statement : [statement];
  if (statement === undefined) {
    errors.push('The policy is missing "Statement".');
  } else if (!Array.isArray(statement) && !isRecord(statement)) {
    errors.push('"Statement" must be an object or an array of objects.');
  }

  let grantsPublicAccess = false;
  if (Array.isArray(statement) && statement.length === 0) {
    errors.push('"Statement" must contain at least one statement.');
  }
  statements.forEach((entry, index) => {
    const result = checkStatement(entry, index);
    errors.push(...result.errors);
    grantsPublicAccess ||= result.publicAccess;
  });

  return {
    jsonError: null,
    structureErrors: errors,
    valid: errors.length === 0,
    grantsPublicAccess,
  };
}

/** The example the empty policy editor starts from, matching the console. */
export const EXAMPLE_BUCKET_POLICY = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadGetObject',
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: ['arn:aws:s3:::my-bucket/*'],
      },
    ],
  },
  null,
  2,
);
