import {
  API_PATHS,
  type ServiceDetailResponse,
  type ServiceOperationsResponse,
  type ServiceRegistryResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import {
  getServiceOperations,
  getServiceRegistry,
  localStackKeysOf,
  requireServiceById,
} from '../registry/services.js';

/**
 * The service registry over HTTP. `GET /api/services` is the authoritative
 * list of services LocalDeck knows about (id, category, sdk package, operation
 * whitelist, parity level); `GET /api/services/:serviceId` resolves one entry;
 * `GET /api/services/:serviceId/operations` returns the dispatcher whitelist
 * plus the generic-browser binding (listOp with required params, describe,
 * delete, tags). None of these routes touch LocalStack, so they answer even
 * when the emulator is down.
 */
export function registerServiceRoutes(app: FastifyInstance): void {
  app.get(API_PATHS.services, async (): Promise<ServiceRegistryResponse> => {
    return getServiceRegistry();
  });

  app.get<{ Params: { serviceId: string } }>(
    API_PATHS.serviceOperations,
    async (request): Promise<ServiceOperationsResponse> => {
      return getServiceOperations(request.params.serviceId);
    },
  );

  app.get(`${API_PATHS.services}/:serviceId`, async (request): Promise<ServiceDetailResponse> => {
    const { serviceId } = request.params as { serviceId: string };
    return {
      service: requireServiceById(serviceId),
      localStackKeys: localStackKeysOf(serviceId),
    };
  });
}
