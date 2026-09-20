import {
  API_PATHS,
  ApiErrorCodes,
  type ApiErrorResponse,
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

export interface DispatcherRouteOptions {
  /**
   * Largest serialized result the route will send. A runaway list operation
   * (an unfiltered scan) would otherwise buffer hundreds of megabytes into the
   * tab; above the cap the route answers 502 EMULATOR_RESPONSE_TOO_LARGE.
   */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
  options: DispatcherRouteOptions = {},
): void {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

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
      onSend: async (request, reply, payload) => {
        if (typeof payload !== 'string') return payload;
        const bytes = Buffer.byteLength(payload);
        if (bytes <= maxResponseBytes) return payload;

        const params = request.params as Partial<DispatcherParams>;
        const serviceId = params.serviceId ?? 'unknown';
        const operation = params.operation ?? 'unknown';
        request.log.warn(
          { serviceId, operation, bytes, limitBytes: maxResponseBytes },
          'dispatcher response exceeds the size cap',
        );
        void reply.code(502);
        reply.removeHeader('content-length');
        return JSON.stringify({
          error: {
            code: ApiErrorCodes.emulatorResponseTooLarge,
            statusCode: 502,
            message:
              `The ${serviceId} "${operation}" response is ${formatMiB(bytes)}, above the ` +
              `${formatMiB(maxResponseBytes)} LocalDeck cap. Narrow the request (filters, ` +
              'pagination) or raise DISPATCHER_MAX_RESPONSE_BYTES.',
            service: serviceId,
            details: { service: serviceId, operation, bytes, limitBytes: maxResponseBytes },
          },
        } satisfies ApiErrorResponse);
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
