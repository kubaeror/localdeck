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

/** Packages rows into the console's pagination envelope. */
export function toPaginated<T>(items: readonly T[], nextToken?: string): Paginated<T> {
  return { items, ...(nextToken === undefined ? {} : { nextToken }) };
}
