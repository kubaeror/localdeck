import {
  API_PATHS,
  type ServiceDetailResponse,
  type ServiceOperationsResponse,
  type ServiceRegistryResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import {
  getService,
  getServiceOperations,
  getServiceRegistry,
  localStackKeysOf,
} from '../registry/services.js';

/**
 * The service registry over HTTP. `GET /api/services` is the authoritative
 * list of services LocalDeck knows about (id, category, sdk package, operation
 * whitelist, parity level, runtime availability); `GET /api/services/:serviceId`
 * resolves one entry; `GET /api/services/:serviceId/operations` returns the
 * dispatcher whitelist plus the generic-browser binding. None of these routes
 * touch LocalStack, so they answer even when the emulator is down.
 */

/** Shared param shape for every `:serviceId` route. */
const SERVICE_ID_PARAMS_SCHEMA = {
  type: 'object',
  required: ['serviceId'],
  additionalProperties: false,
  properties: {
    serviceId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9][a-z0-9-]*$' },
  },
} as const;

interface ServiceIdParams {
  serviceId: string;
}

export function registerServiceRoutes(app: FastifyInstance): void {
  app.get(API_PATHS.services, async (): Promise<ServiceRegistryResponse> => {
    return getServiceRegistry();
  });

  app.get<{ Params: ServiceIdParams }>(
    API_PATHS.serviceOperations,
    { schema: { params: SERVICE_ID_PARAMS_SCHEMA } },
    async (request): Promise<ServiceOperationsResponse> => {
      return getServiceOperations(request.params.serviceId);
    },
  );

  app.get<{ Params: ServiceIdParams }>(
    `${API_PATHS.services}/:serviceId`,
    { schema: { params: SERVICE_ID_PARAMS_SCHEMA } },
    async (request): Promise<ServiceDetailResponse> => {
      const { serviceId } = request.params;
      return {
        service: getService(serviceId),
        localStackKeys: localStackKeysOf(serviceId),
      };
    },
  );
}
