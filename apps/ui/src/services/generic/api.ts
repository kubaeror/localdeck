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

/** Metadata records that never carry a pagination token. */
const IGNORED_TOKEN_CONTAINERS = new Set(['ResponseMetadata', '$metadata']);

/**
 * Response fields AWS uses for a continuation token, in detection order.
 * `NextMarker` intentionally precedes `Marker`: services that echo the request
 * marker and also return the next one (CloudFront, EFS) need the "next" field.
 */
const PAGINATION_FIELDS = [
  'NextToken',
  'nextToken',
  'nextPageToken',
  'NextContinuationToken',
  'ContinuationToken',
  'continuationToken',
  'NextMarker',
  'Marker',
  'LastEvaluatedTableName',
] as const;

/**
 * The request field that consumes each response token. Most services reuse the
 * same name; DynamoDB is the notable exception.
 */
const TOKEN_REQUEST_FIELDS: Readonly<Record<string, string>> = {
  NextToken: 'NextToken',
  nextToken: 'nextToken',
  nextPageToken: 'nextPageToken',
  NextContinuationToken: 'ContinuationToken',
  ContinuationToken: 'ContinuationToken',
  continuationToken: 'continuationToken',
  NextMarker: 'Marker',
  Marker: 'Marker',
  LastEvaluatedTableName: 'ExclusiveStartTableName',
};

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

/** Fallback id prefix for a response that did not come from a continuation token. */
const FIRST_PAGE_KEY = 'first-page';

export interface MapListResultOptions {
  /**
   * Continuation token this response was fetched with, when any. Rows without
   * an inferable id fall back to `${pageKey}:${index}`; the index alone would
   * restart on every page and collide across "Load more".
   */
  pageKey?: string;
}

/**
 * Maps one list response onto rows using the registry's resultPath/idField/
 * nameField hints, falling back to the tolerant inference when a hint does not
 * resolve for a given response.
 */
export function mapListResult(
  result: unknown,
  list: ServiceBrowserListOperation,
  options: MapListResultOptions = {},
): { rows: GenericResourceRow[]; nextToken?: string } {
  const pageKey = options.pageKey ?? FIRST_PAGE_KEY;
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
        return `${pageKey}:${index}`;
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

/** One resolved continuation token plus the request field that consumes it. */
export interface NextPageToken {
  token: string;
  requestField: string;
}

/**
 * All dotted paths in a response that hold a known pagination token, including
 * nested containers (CloudFront nests `NextMarker` inside `DistributionList`).
 */
function paginationPaths(result: unknown): string[] {
  const paths: string[] = [];
  const visit = (record: Record<string, unknown>, prefix: string, depth: number): void => {
    if (depth > 3 || paths.length >= 50) return;
    for (const field of PAGINATION_FIELDS) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        paths.push(prefix.length === 0 ? field : `${prefix}.${field}`);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (IGNORED_TOKEN_CONTAINERS.has(key)) continue;
      if (isRecord(value)) visit(value, prefix.length === 0 ? key : `${prefix}.${key}`, depth + 1);
    }
  };
  if (isRecord(result)) visit(result, '', 1);
  return paths;
}

/**
 * Resolves the next page contract for a list response. The registry's explicit
 * `pagination` wins; otherwise the response field that produced the token
 * decides the request field (`Marker` → `Marker`, `LastEvaluatedTableName` →
 * `ExclusiveStartTableName`, …).
 */
export function nextPageFromResult(
  result: unknown,
  list: ServiceBrowserListOperation,
): NextPageToken | undefined {
  if (list.pagination !== undefined) {
    const token = stringValue(readPath(result, list.pagination.responseField));
    return token === undefined ? undefined : { token, requestField: list.pagination.requestField };
  }
  if (list.nextTokenParam !== undefined) {
    const token = stringValue(readPath(result, list.nextTokenParam));
    return token === undefined ? undefined : { token, requestField: list.nextTokenParam };
  }
  for (const path of paginationPaths(result)) {
    const field = path.split('.').pop() ?? '';
    const requestField = TOKEN_REQUEST_FIELDS[field];
    const token = stringValue(readPath(result, path));
    if (requestField !== undefined && token !== undefined) return { token, requestField };
  }
  return undefined;
}

/** Reads a continuation token from whichever field the service used. */
export function nextTokenFromResult(
  result: unknown,
  list: ServiceBrowserListOperation,
): string | undefined {
  return nextPageFromResult(result, list)?.token;
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

/**
 * The request field a pagination token belongs to, remembered per binding.
 * A page response determines it (from the registry contract or the response
 * field) and the next "load more" call reuses it; without this an inferred
 * `Marker` token would be sent as `NextToken` and the same page would repeat.
 */
const tokenRequestFields = new Map<string, string>();

/**
 * Tokens already requested for one listing. Services echo a token when there
 * is no further page; asking for it again would append the same rows forever.
 * The set is cleared whenever a listing restarts from the first page (refresh,
 * navigation), so a token a new browsing session legitimately reuses is not
 * mistaken for a loop.
 */
const usedPaginationTokens = new Map<string, Set<string>>();

function bindingKey(descriptor: ServiceDescriptor, list: ServiceBrowserListOperation): string {
  return `${descriptor.id}/${list.operation}`;
}

function paginationLoopError(descriptor: ServiceDescriptor, token: string): ApiClientError {
  return new ApiClientError({
    code: 'PAGINATION_LOOP',
    statusCode: 502,
    message:
      `The ${descriptor.displayName} list operation repeated the pagination token "${token}" ` +
      'instead of returning a new one. Loading stopped to avoid appending the same page forever.',
    service: descriptor.id,
  } satisfies ApiError);
}

/** Fetches one page of resources through the service's listOp. */
export async function listGenericResources(
  descriptor: ServiceDescriptor,
  options: { nextToken?: string; signal?: AbortSignal } = {},
): Promise<Paginated<GenericResourceRow>> {
  const browser = descriptor.browser;
  if (browser === undefined) return toPaginated([]);

  const list = browser.list;
  const key = bindingKey(descriptor, list);
  if (options.nextToken === undefined) {
    usedPaginationTokens.delete(key);
  } else {
    const used = usedPaginationTokens.get(key) ?? new Set<string>();
    if (used.has(options.nextToken)) throw paginationLoopError(descriptor, options.nextToken);
    used.add(options.nextToken);
    usedPaginationTokens.set(key, used);
  }

  const tokenParam =
    list.pagination?.requestField ??
    list.nextTokenParam ??
    (options.nextToken === undefined ? 'NextToken' : (tokenRequestFields.get(key) ?? 'NextToken'));
  const input: Record<string, unknown> = {
    ...browserOperationInput(list),
    ...(options.nextToken === undefined ? {} : { [tokenParam]: options.nextToken }),
  };
  const result = await callServiceOperation(descriptor.id, list.operation, input, options.signal);
  const { rows } = mapListResult(result, list, {
    ...(options.nextToken === undefined ? {} : { pageKey: options.nextToken }),
  });
  const nextPage = nextPageFromResult(result, list);
  // Remember the field for this binding. It never changes for a given list
  // operation, so a page without a token leaves the entry in place: a
  // concurrent detail-page walk may still need it.
  if (nextPage !== undefined) tokenRequestFields.set(key, nextPage.requestField);
  return toPaginated(rows, nextPage?.token);
}

/**
 * How many list pages `describeGenericResource` walks when the service has no
 * describe binding. The old cap of 10 was low enough that a resource on a
 * larger listing came back as "not found"; it is high enough now to cover a
 * realistic listing while still bounding a misbehaving pagination loop.
 */
export const DESCRIBE_FALLBACK_PAGE_LIMIT = 50;

export interface DescribeGenericResourceOptions {
  /** Overrides {@link DESCRIBE_FALLBACK_PAGE_LIMIT}; mainly useful in tests. */
  maxPages?: number;
}

/**
 * Describes one resource. Services without a describe binding fall back to
 * paging the list operation until the row with this id is found.
 */
export async function describeGenericResource(
  descriptor: ServiceDescriptor,
  resourceId: string,
  signal?: AbortSignal,
  options: DescribeGenericResourceOptions = {},
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
    const itemField = browser.describe.resultItemField;
    if (itemField !== undefined) {
      const value = readPath(result, itemField);
      // Batch describes (CodeBuild BatchGetProjects) return a list; unwrap the
      // requested resource so the detail page shows its fields, not the batch.
      if (Array.isArray(value)) {
        const item = value.find(isRecord);
        if (item !== undefined) return item;
      }
    }
    return isRecord(result) ? result : { value: result };
  }

  const maxPages = options.maxPages ?? DESCRIBE_FALLBACK_PAGE_LIMIT;
  let nextToken: string | undefined;
  let pagesScanned = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const current = await listGenericResources(descriptor, {
      ...(nextToken === undefined ? {} : { nextToken }),
      ...(signal === undefined ? {} : { signal }),
    });
    pagesScanned += 1;
    const match = current.items.find((row) => row.id === resourceId);
    if (match !== undefined) return match.raw;
    if (current.nextToken === undefined) {
      throw new ApiClientError({
        code: 'RESOURCE_NOT_FOUND',
        statusCode: 404,
        message:
          `${descriptor.displayName} did not return a resource with the id "${resourceId}": ` +
          `the list operation was exhausted after ${pagesScanned} page(s).`,
        service: descriptor.id,
      } satisfies ApiError);
    }
    nextToken = current.nextToken;
  }
  throw new ApiClientError({
    code: 'RESOURCE_NOT_FOUND',
    statusCode: 404,
    message:
      `${descriptor.displayName} did not return a resource with the id "${resourceId}" ` +
      `within the first ${maxPages} pages.`,
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
    const value = readPath(result, path);
    // A missing or non-array path is "unavailable", not "no tags": the detail
    // page must not claim a resource is untagged when the read was misconfigured.
    return Array.isArray(value) ? tagsFromArray(value) : undefined;
  }

  const embedded = described.Tags ?? described.tags;
  return Array.isArray(embedded) ? tagsFromArray(embedded) : undefined;
}
