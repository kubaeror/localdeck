import type {
  ApiError,
  Paginated,
  ServiceBrowserListOperation,
  ServiceBrowserOperation,
  ServiceDescriptor,
} from '@localdeck/shared';
import { ApiClientError } from '../../lib/apiClient';
import { callServiceOperation, toPaginated } from '../../lib/serviceOperations';

/**
 * Data access for the generated resource browser. Every call goes through the
 * api's dynamic dispatcher (`callServiceOperation`), and the registry's
 * browser spec decides which whitelisted operation to call and how to map the
 * response onto rows. Nothing here talks to the AWS SDK directly.
 */

/** One row on a generated resource list. */
export interface GenericResourceRow {
  /** Stable identifier used for keys and the detail route. */
  id: string;
  /** Human label rendered first in the table. */
  label: string;
  /** The raw SDK object, kept for the detail and JSON views. */
  raw: Record<string, unknown>;
}

/** One tag on a generated detail page. */
export interface GenericTag {
  key: string;
  value: string;
}

/** Response properties that never hold the resource collection. */
const IGNORED_KEYS = new Set(['ResponseMetadata', '$metadata', 'NextToken', 'nextToken']);

/** Fields AWS uses for a resource name, in the order we prefer them. */
const ID_FALLBACKS = [
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
  'TopicArn',
  'QueueUrl',
  'ClusterArn',
  'TableName',
  'FunctionName',
  'Bucket',
  'logGroupName',
  'thingName',
  'StreamName',
  'VaultName',
];

const PAGINATION_FIELDS = ['NextToken', 'nextToken', 'ContinuationToken', 'Marker', 'NextMarker'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a dotted path (`DistributionList.Items`) out of an SDK response. */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function fieldList(field: string | readonly string[] | undefined): readonly string[] {
  if (field === undefined) return [];
  return typeof field === 'string' ? [field] : field;
}

/** Joins the configured item fields; `undefined` when none is present. */
function extractFields(
  container: unknown,
  field: string | readonly string[] | undefined,
): string | undefined {
  const fields = fieldList(field);
  if (fields.length === 0) return undefined;
  const values = fields.flatMap((path) => {
    const value = stringValue(readPath(container, path));
    return value === undefined ? [] : [value];
  });
  return values.length > 0 ? values.join(' / ') : undefined;
}

/** Finds the array the registry points at, or the first array in the result. */
function findCollection(
  result: unknown,
  list: ServiceBrowserListOperation,
): readonly unknown[] | undefined {
  if (list.resultPath !== undefined) {
    const value = readPath(result, list.resultPath);
    if (Array.isArray(value)) return value;
  }
  if (!isRecord(result)) return undefined;
  for (const [key, value] of Object.entries(result)) {
    if (IGNORED_KEYS.has(key)) continue;
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

/**
 * Maps one list response onto rows using the registry's resultPath/idField/
 * nameField hints, falling back to the tolerant inference when a hint does not
 * resolve for a given response.
 */
export function mapListResult(
  result: unknown,
  list: ServiceBrowserListOperation,
): { rows: GenericResourceRow[]; nextToken?: string } {
  const collection = findCollection(result, list);
  const rows = (collection ?? []).flatMap((entry, index): GenericResourceRow[] => {
    if (typeof entry === 'string') {
      return [{ id: entry, label: entry, raw: { Name: entry } }];
    }
    if (!isRecord(entry)) return [];
    const id =
      extractFields(entry, list.idField) ??
      ((): string => {
        for (const field of ID_FALLBACKS) {
          const value = stringValue(entry[field]);
          if (value !== undefined) return value;
        }
        return String(index);
      })();
    const label = extractFields(entry, list.nameField) ?? id;
    return [{ id, label, raw: entry }];
  });

  const nextToken = nextTokenFromResult(result, list);
  return {
    rows,
    ...(nextToken === undefined ? {} : { nextToken }),
  };
}

/** Reads a continuation token from whichever field the service used. */
export function nextTokenFromResult(
  result: unknown,
  list: ServiceBrowserListOperation,
): string | undefined {
  if (list.nextTokenParam !== undefined) {
    const direct = stringValue(readPath(result, list.nextTokenParam));
    if (direct !== undefined) return direct;
  }
  for (const field of PAGINATION_FIELDS) {
    const value = stringValue(readPath(result, field));
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Builds the input for one mapped operation, merging required params and id. */
export function browserOperationInput(
  spec: ServiceBrowserOperation,
  resourceId?: string,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...(spec.input ?? {}) };
  if (resourceId !== undefined && spec.idParam !== undefined) {
    input[spec.idParam] = spec.idParamIsArray === true ? [resourceId] : resourceId;
  }
  return input;
}

/** Fetches one page of resources through the service's listOp. */
export async function listGenericResources(
  descriptor: ServiceDescriptor,
  options: { nextToken?: string; signal?: AbortSignal } = {},
): Promise<Paginated<GenericResourceRow>> {
  const browser = descriptor.browser;
  if (browser === undefined) return toPaginated([]);

  const list = browser.list;
  const tokenParam = list.nextTokenParam ?? 'NextToken';
  const input: Record<string, unknown> = {
    ...browserOperationInput(list),
    ...(options.nextToken === undefined ? {} : { [tokenParam]: options.nextToken }),
  };
  const result = await callServiceOperation(descriptor.id, list.operation, input, options.signal);
  const { rows, nextToken } = mapListResult(result, list);
  return toPaginated(rows, nextToken);
}

/**
 * Describes one resource. Services without a describe binding fall back to
 * paging the list operation until the row with this id is found.
 */
export async function describeGenericResource(
  descriptor: ServiceDescriptor,
  resourceId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const browser = descriptor.browser;
  if (browser === undefined) throw new Error(`${descriptor.id} has no generic browser binding.`);

  if (browser.describe !== undefined) {
    const result = await callServiceOperation(
      descriptor.id,
      browser.describe.operation,
      browserOperationInput(browser.describe, resourceId),
      signal,
    );
    return isRecord(result) ? result : { value: result };
  }

  let nextToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const current = await listGenericResources(descriptor, {
      ...(nextToken === undefined ? {} : { nextToken }),
      ...(signal === undefined ? {} : { signal }),
    });
    const match = current.items.find((row) => row.id === resourceId);
    if (match !== undefined) return match.raw;
    if (current.nextToken === undefined) break;
    nextToken = current.nextToken;
  }
  throw new ApiClientError({
    code: 'RESOURCE_NOT_FOUND',
    statusCode: 404,
    message: `${descriptor.displayName} did not return a resource with the id "${resourceId}".`,
    service: descriptor.id,
  } satisfies ApiError);
}

/** Calls the delete operation bound by the registry. */
export async function deleteGenericResource(
  descriptor: ServiceDescriptor,
  resourceId: string,
  signal?: AbortSignal,
): Promise<void> {
  const browser = descriptor.browser;
  if (browser?.delete === undefined) {
    throw new Error(`${descriptor.id} has no generic delete binding.`);
  }
  await callServiceOperation(
    descriptor.id,
    browser.delete.operation,
    browserOperationInput(browser.delete, resourceId),
    signal,
  );
}

function tagsFromArray(value: unknown): GenericTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): GenericTag[] => {
    if (!isRecord(entry)) return [];
    const key = stringValue(entry.Key) ?? stringValue(entry.key);
    const tagValue = stringValue(entry.Value) ?? stringValue(entry.value) ?? '';
    return key === undefined ? [] : [{ key, value: tagValue }];
  });
}

/**
 * Loads the tags for one resource: the registry's tags operation when bound,
 * otherwise a `Tags`/`tags` array inside the describe response. Returns
 * `undefined` when the service exposes neither (the detail page explains).
 */
export async function loadGenericResourceTags(
  descriptor: ServiceDescriptor,
  described: Record<string, unknown>,
  resourceId: string,
  signal?: AbortSignal,
): Promise<GenericTag[] | undefined> {
  const browser = descriptor.browser;
  if (browser === undefined) return undefined;

  if (browser.tags !== undefined) {
    const result = await callServiceOperation(
      descriptor.id,
      browser.tags.operation,
      browserOperationInput(browser.tags, resourceId),
      signal,
    );
    const path = browser.tags.resultPath ?? 'Tags';
    return tagsFromArray(readPath(result, path));
  }

  const embedded = tagsFromArray(described.Tags ?? described.tags);
  return Array.isArray(described.Tags ?? described.tags) ? embedded : undefined;
}
