import {
  ApiErrorCodes,
  SERVICE_CATALOG,
  findService,
  localStackKeysFor,
  serviceCategories,
  type ServiceDescriptor,
  type ServiceOperationsResponse,
  type ServiceRegistryResponse,
} from '@localdeck/shared';
import { ApiProblem } from '../lib/errors.js';

/**
 * LocalDeck's service registry for the api side.
 *
 * The catalogue itself lives in `@localdeck/shared` so the api (which proxies
 * the operations) and the ui (which renders the console) can never drift. This
 * module is the api's access layer: it answers registry queries and is the
 * single place a route resolves a service id.
 */

/** The full registry: every known service plus the category index. */
export function getServiceRegistry(): ServiceRegistryResponse {
  return {
    services: SERVICE_CATALOG,
    categories: serviceCategories(),
  };
}

/**
 * Looks a service up by console id and throws the shared 404 ApiError shape for
 * ids we do not know, so routes never duplicate the error message.
 */
export function requireServiceById(id: string): ServiceDescriptor {
  const service = findService(id);
  if (service === undefined) {
    throw new ApiProblem({
      code: ApiErrorCodes.notFound,
      statusCode: 404,
      message: `No LocalDeck service is registered with the id "${id}".`,
      details: { serviceId: id },
    });
  }
  return service;
}

/**
 * The operation metadata for one service: the dispatcher whitelist plus the
 * generic-browser binding (listOp with its required params, describe, delete,
 * tags). Resolved through the registry so a generated module can always ask
 * the api what it is allowed to call.
 */
export function getServiceOperations(id: string): ServiceOperationsResponse {
  const service = requireServiceById(id);
  return {
    service: service.id,
    operations: service.operations,
    ...(service.browser === undefined ? {} : { browser: service.browser }),
  };
}

/** LocalStack health keys that identify a registered service. */
export function localStackKeysOf(id: string): readonly string[] {
  return localStackKeysFor(requireServiceById(id));
}
