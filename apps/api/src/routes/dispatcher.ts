import {
  API_PATHS,
  type ServiceOperationRequest,
  type ServiceOperationResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AwsClientConfigOverrides } from '../lib/awsClients.js';
import { dispatchServiceOperation } from '../registry/dispatcher.js';

interface DispatcherParams {
  service: string;
  operation: string;
}

/**
 * `POST /api/services/:service/:operation` — the dynamic service dispatcher.
 *
 * The body is `{ "input": { ... } }` with the operation input exactly as the
 * AWS SDK expects it. Validation here only rejects malformed requests; the
 * registry decides whether the service exists (404) and whether the operation
 * is whitelisted (400).
 */
export function registerDispatcherRoutes(
  app: FastifyInstance,
  clientOverrides: AwsClientConfigOverrides = {},
): void {
  app.post<{ Params: DispatcherParams; Body: ServiceOperationRequest }>(
    API_PATHS.serviceOperation,
    {
      schema: {
        params: {
          type: 'object',
          required: ['service', 'operation'],
          properties: {
            service: { type: 'string', minLength: 1, maxLength: 64 },
            operation: {
              type: 'string',
              minLength: 1,
              maxLength: 128,
              // AWS operation names are PascalCase words, e.g. ListBuckets.
              pattern: '^[A-Za-z][A-Za-z0-9]*$',
            },
          },
        },
        body: {
          // `null` covers requests without a body: the dispatcher defaults the
          // input to `{}`.
          type: ['object', 'null'],
          properties: {
            input: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ServiceOperationResponse> => {
      const { service, operation } = request.params;
      const input = request.body?.input ?? {};
      return dispatchServiceOperation(service, operation, input, clientOverrides);
    },
  );
}
