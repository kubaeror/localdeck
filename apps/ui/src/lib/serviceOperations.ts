import {
  serviceOperationPath,
  type Paginated,
  type ServiceOperationResponse,
} from '@localdeck/shared';
import { postJson } from './apiClient';

/**
 * Client for the api's dynamic dispatcher. The browser never talks to the AWS
 * SDK: service modules call this and the api validates the operation against
 * the registry whitelist before proxying it.
 */
export async function callServiceOperation<TOutput = unknown>(
  serviceId: string,
  operation: string,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<TOutput> {
  const response = await postJson<ServiceOperationResponse<TOutput>>(
    serviceOperationPath(serviceId, operation),
    { input },
    signal,
  );
  return response.result;
}

/** One row on a generated resource list. */
export interface ResourceRow {
  /** Stable identifier: keys, selection and the detail route use it. */
  id: string;
  /** Human label rendered first in the table. */
  label: string;
  /** The raw SDK object, kept for detail pages and JSON views. */
  raw: Record<string, unknown>;
}

/** Fields AWS uses for a resource name, in the order we prefer them. */
const ID_FIELDS = [
  'Name',
  'name',
  'Id',
  'ID',
  'id',
  'Identifier',
  'identifier',
  'Arn',
  'ARN',
  'arn',
  'QueueUrl',
  'TopicArn',
  'ClusterArn',
  'TableName',
  'FunctionName',
  'Bucket',
];

/** Response properties that never hold the resource collection. */
const IGNORED_KEYS = new Set(['ResponseMetadata', '$metadata', 'NextToken', 'nextToken']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function idFromRecord(record: Record<string, unknown>, index: number): string {
  for (const field of ID_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return String(index);
}

function labelFromRecord(record: Record<string, unknown>, fallback: string): string {
  for (const field of ['Name', 'name', 'Id', 'ID', 'id', 'Arn', 'ARN', 'arn']) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
}

/** Finds the first response property that looks like the resource collection. */
function findCollection(result: unknown): readonly unknown[] | undefined {
  if (!isRecord(result)) return undefined;
  for (const [key, value] of Object.entries(result)) {
    if (IGNORED_KEYS.has(key)) continue;
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

/**
 * Maps a raw SDK response onto list rows. Generated modules use this as a
 * working default; a service module can replace it with a typed mapper.
 */
export function extractResourceRows(result: unknown): ResourceRow[] {
  const collection = findCollection(result);
  if (collection === undefined) return [];

  return collection.flatMap((entry, index): ResourceRow[] => {
    if (typeof entry === 'string') {
      return [{ id: entry, label: entry, raw: { Name: entry } }];
    }
    if (isRecord(entry)) {
      const id = idFromRecord(entry, index);
      return [{ id, label: labelFromRecord(entry, id), raw: entry }];
    }
    return [];
  });
}

/** Packages rows into the console's pagination envelope. */
export function toPaginated<T>(items: readonly T[], nextToken?: string): Paginated<T> {
  return { items, ...(nextToken === undefined ? {} : { nextToken }) };
}

/** Reads a pagination token from whichever field the service used. */
export function nextTokenFrom(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  for (const field of ['NextToken', 'nextToken', 'ContinuationToken', 'Marker', 'NextMarker']) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
