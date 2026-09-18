import {
  API_PATHS,
  type ServiceOperationRequest,
  type ServiceOperationResponse,
} from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import type { AwsClientConfigOverrides } from '../lib/awsClients.js';
import { clientDisconnectSignal } from '../lib/http.js';
import { dispatchServiceOperation } from '../registry/dispatcher.js';

interface DispatcherParams {
  serviceId: string;
  operation: string;
}

/**
 * `POST /api/services/:serviceId/:operation` — the dynamic service dispatcher.
 *
 * The body is `{ "input": { ... } }` with the operation input exactly as the
 * AWS SDK expects it (`additionalProperties: true` is intentional: every AWS
 * operation has a different input shape, and the SDK serializer is the
 * authority on what it accepts). Validation here only rejects malformed
 * requests; the registry decides whether the service exists (404) and whether
 * the operation is whitelisted (400).
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
          required: ['serviceId', 'operation'],
          additionalProperties: false,
          properties: {
            serviceId: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: '^[a-z0-9][a-z0-9-]*$',
            },
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
    async (request, reply): Promise<ServiceOperationResponse> => {
      const { serviceId, operation } = request.params;
      const input = request.body?.input ?? {};
      // The client-disconnect signal is combined with the SDK request timeout
      // inside the dispatcher; Fastify's own request.signal is unusable here
      // because it aborts as soon as a request body has been parsed.
      return dispatchServiceOperation(serviceId, operation, input, clientOverrides, {
        signal: clientDisconnectSignal(reply),
      });
    },
  );
}
