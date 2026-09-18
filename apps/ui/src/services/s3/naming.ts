/**
 * S3 bucket naming rules, in the wording the AWS console uses. The create
 * wizard validates against these before calling the api, so a typo becomes an
 * inline field error instead of a rejected request.
 *
 * Reference: general-purpose bucket naming rules (3–63 characters, lowercase
 * letters/numbers/dots/hyphens, no adjacent periods, not an IP address, and
 * the reserved prefixes/suffixes).
 */

import { isS3KeyWithinLimit, S3_KEY_MAX_BYTES, utf8ByteLength } from '@localdeck/shared';

const MIN_LENGTH = 3;
const MAX_LENGTH = 63;

/** Returned by {@link validateBucketName} when a name is acceptable. */
export type BucketNameError = string | null;

const RESERVED_PREFIXES = ['xn--', 'sthree-', 'amzn-s3-demo-'] as const;
const RESERVED_SUFFIXES = ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3'] as const;

/** The rules rendered as the field's constraint text. */
export function bucketNameRules(): readonly string[] {
  return [
    `Between ${MIN_LENGTH} and ${MAX_LENGTH} characters long`,
    'Only lowercase letters, numbers, dots (.) and hyphens (-)',
    'Must begin and end with a letter or number',
    'Must not contain two adjacent periods',
    'Must not be formatted as an IP address (for example, 192.168.5.4)',
    'Must not start with "xn--", "sthree-" or "amzn-s3-demo-"',
    'Must not end with "-s3alias", "--ol-s3", ".mrap", "--x-s3" or "--table-s3"',
  ];
}

/** True when the value is four dot-separated decimal octets. */
function looksLikeIpAddress(name: string): boolean {
  const parts = name.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number.parseInt(part, 10) <= 255);
}

/**
 * Validates a general-purpose S3 bucket name. Returns `null` when the name is
 * acceptable, otherwise the first problem in console wording.
 */
export function validateBucketName(name: string): BucketNameError {
  if (name.length === 0) return 'Enter a bucket name.';
  if (name.length < MIN_LENGTH) {
    return `Bucket name must be at least ${MIN_LENGTH} characters long.`;
  }
  if (name.length > MAX_LENGTH) {
    return `Bucket name must be no more than ${MAX_LENGTH} characters long.`;
  }
  if (!/^[a-z0-9.-]+$/.test(name)) {
    return 'Bucket name can only contain lowercase letters, numbers, dots (.) and hyphens (-).';
  }
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) {
    return 'Bucket name must begin and end with a letter or number.';
  }
  if (name.includes('..')) {
    return 'Bucket name must not contain two adjacent periods.';
  }
  if (looksLikeIpAddress(name)) {
    return 'Bucket name must not be formatted as an IP address (for example, 192.168.5.4).';
  }
  const reservedPrefix = RESERVED_PREFIXES.find((prefix) => name.startsWith(prefix));
  if (reservedPrefix !== undefined) {
    return `Bucket name must not start with the reserved prefix "${reservedPrefix}".`;
  }
  const reservedSuffix = RESERVED_SUFFIXES.find((suffix) => name.endsWith(suffix));
  if (reservedSuffix !== undefined) {
    return `Bucket name must not end with the reserved suffix "${reservedSuffix}".`;
  }
  return null;
}

/**
 * Regions the create wizard offers. LocalStack accepts any region; the list is
 * the console's common set so the dropdown feels familiar.
 */
export const S3_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-south-1',
  'sa-east-1',
] as const;

/**
 * `CreateBucket` only wants a `CreateBucketConfiguration` outside us-east-1,
 * which is the API's legacy-region special case.
 */
export function needsLocationConstraint(region: string): boolean {
  return region !== '' && region !== 'us-east-1';
}

/**
 * S3 object keys may be at most 1024 UTF-8 bytes (not UTF-16 code units), and
 * those bytes must not include `.` or `..` path segments: the api refuses them
 * because URL normalization would silently address a different object.
 */
export function validateObjectKey(key: string): string | null {
  if (key.trim().length === 0) return 'Enter an object key.';
  if (!isS3KeyWithinLimit(key)) {
    return `Object keys can be at most ${S3_KEY_MAX_BYTES} UTF-8 bytes long; this key uses ${utf8ByteLength(key)} bytes.`;
  }
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    return 'Object keys must not contain "." or ".." path segments.';
  }
  return null;
}

/** Normalizes a prefix typed by the user: `''` or `'a/b'` → `''` / `'a/b/'`. */
export function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '');
  if (trimmed.length === 0) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
