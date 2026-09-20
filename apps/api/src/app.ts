import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ApiErrorCodes, getEmulatorProvider, type ApiErrorResponse } from '@localdeck/shared';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { getConfig, type AppConfig } from './config.js';
import { ApiProblem, toApiError } from './lib/errors.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerDispatcherRoutes } from './routes/dispatcher.js';
import { registerEksRoutes } from './routes/eks.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerS3Routes } from './routes/s3.js';
import { registerServiceRoutes } from './routes/services.js';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: FastifyServerOptions['logger'];
  /**
   * Replaces the default 404/405 handler. The console sidecar uses it to serve
   * the SPA's index.html for non-api routes; the api keeps its JSON contract.
   */
  notFoundHandler?: (request: FastifyRequest, reply: FastifyReply) => void;
}

/**
 * True when a concrete request path matches a registered route pattern such as
 * `/api/services/:serviceId`. Only the parameter syntax LocalDeck uses (`:name`
 * as a whole segment) is supported, which is exactly Fastify's syntax here.
 */
function routePatternMatches(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

/**
 * Pino options from the effective configuration. Pretty logging is a
 * development convenience; production never asks for the pino-pretty
 * transport (the release image does not ship the devDependency).
 */
export function createLoggerOptions(config: AppConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // Credentials must never reach the log stream.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    ...(config.logPretty && !config.isProduction
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/**
 * Error context shared by every route: the endpoint, plus the provider label
 * when one is pinned. In auto mode the label is unknown until the health probe
 * runs, so error copy falls back to "the local emulator".
 */
export function errorContext(config: AppConfig): {
  endpoint: string;
  emulatorLabel?: string;
} {
  return config.emulatorProvider === 'auto'
    ? { endpoint: config.emulatorEndpoint }
    : {
        endpoint: config.emulatorEndpoint,
        emulatorLabel: getEmulatorProvider(config.emulatorProvider).displayName,
      };
}

/**
 * True for the proxy surface (`/api` and `/api/...`). Everything else is a
 * static/SPA path (the console sidecar serves the built ui), which must never
 * be throttled: one page load fetches dozens of hashed chunks.
 */
function isApiPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path === '/api' || path.startsWith('/api/');
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? getConfig();
  const logger: FastifyServerOptions['logger'] = options.logger ?? createLoggerOptions(config);

  const app = Fastify({
    logger,
    trustProxy: false,
    bodyLimit: 5 * 1024 * 1024,
    // The SDK clients carry their own request timeout; Fastify's handler
    // timeout is the last line of defense for a handler that never settles.
    // Streaming routes (S3 upload/download) override it with a long budget.
    handlerTimeout: config.emulatorRequestTimeoutMs + 1_000,
    // Shutdown must not wait for idle keep-alive sockets, but in-flight
    // requests get to finish: 'idle' closes only keep-alive connections, so a
    // running upload/download is not destroyed at SIGTERM.
    forceCloseConnections: 'idle',
    ajv: {
      // A proxy must reject unknown request properties instead of silently
      // dropping them (Fastify strips them by default).
      customOptions: { removeAdditional: false },
    },
  });

  await app.register(cors, {
    // Default is same-origin only: LocalDeck is an unauthenticated management
    // proxy, so reflecting arbitrary origins would let any website drive the
    // user's emulator. CORS_ORIGIN=* is an explicit opt-in.
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
    exposedHeaders: [
      'content-disposition',
      'x-request-id',
      'x-localdeck-download-mode',
      'x-localdeck-presigned-expires',
      'x-localdeck-kubeconfig',
      'x-localdeck-kubeconfig-endpoint',
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  });

  // The api is an unauthenticated management proxy: a browser bug or a local
  // script must not be able to hammer the emulator without bound. RATE_LIMIT_MAX=0
  // disables the limiter for operators that front the api with their own gateway.
  if (config.rateLimitMax > 0) {
    await app.register(rateLimit, {
      global: true,
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs,
      allowList: (request) => !isApiPath(request.url),
      errorResponseBuilder: (request, context) => {
        const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / 1000));
        request.log.warn(
          { rateLimitMax: context.max, retryAfterSeconds, url: request.url },
          'rate limit exceeded',
        );
        // Returned to Fastify as a thrown error, so it must be an Error that
        // the shared error handler already understands.
        return new ApiProblem({
          code: ApiErrorCodes.rateLimited,
          statusCode: context.statusCode,
          message:
            `LocalDeck received more than ${context.max} requests in ` +
            `${Math.round(config.rateLimitWindowMs / 1000)}s from this client. ` +
            `Retry in ${retryAfterSeconds}s, or raise RATE_LIMIT_MAX.`,
          details: {
            max: context.max,
            windowMs: config.rateLimitWindowMs,
            retryAfterSeconds,
          },
        });
      },
    });
  }

  // Object uploads arrive as multipart/form-data. Limits mirror S3's single
  // object maximum; the S3 upload route streams the part into S3 (multipart
  // upload API above the threshold) instead of buffering it here.
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 1,
    },
    throwFileSizeLimit: true,
  });

  // One place where every thrown value becomes the shared ApiError contract.
  app.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error, errorContext(config));

    if (apiError.statusCode >= 500) {
      request.log.error({ err: error, code: apiError.code }, 'request failed');
    } else {
      request.log.warn({ err: error, code: apiError.code }, 'request rejected');
    }

    if (reply.sent) return;
    void reply.code(apiError.statusCode).send({ error: apiError } satisfies ApiErrorResponse);
  });

  // Correlate every response with the pino request id. Fastify triggers this
  // for error responses too, because the error handler sends through reply.
  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.hasHeader('x-request-id')) {
      void reply.header('x-request-id', request.id);
    }
    return payload;
  });

  // Fastify's `hasRoute` only matches literal URLs, so the not-found handler
  // needs the registered patterns to distinguish 404 from 405.
  const registeredRoutes: { methods: readonly string[]; url: string }[] = [];
  app.addHook('onRoute', (routeOptions) => {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    registeredRoutes.push({
      methods: methods.map((method) => method.toUpperCase()),
      url: routeOptions.url,
    });
  });

  app.setNotFoundHandler(
    options.notFoundHandler ??
      ((request, reply) => {
        const path = request.raw.url?.split('?')[0] ?? request.url;
        const allowed = new Set<string>();
        for (const route of registeredRoutes) {
          if (!routePatternMatches(route.url, path)) continue;
          for (const method of route.methods) {
            if (method !== request.method) allowed.add(method);
          }
        }

        if (allowed.size > 0) {
          // The path exists for another method: 405, not "route not found".
          const allowHeader = [...allowed].join(', ');
          void reply.header('allow', allowHeader);
          void reply.code(405).send({
            error: {
              code: ApiErrorCodes.methodNotAllowed,
              message: `${request.method} is not allowed for ${path}. Allowed: ${allowHeader}.`,
              statusCode: 405,
              details: { allowed: [...allowed] },
            },
          } satisfies ApiErrorResponse);
          return;
        }

        void reply.code(404).send({
          error: {
            code: ApiErrorCodes.notFound,
            message: `No LocalDeck api route matches ${request.method} ${request.url}.`,
            statusCode: 404,
          },
        } satisfies ApiErrorResponse);
      }),
  );

  const clientOverrides = {
    endpoint: config.emulatorEndpoint,
    region: config.region,
    connectionTimeoutMs: config.emulatorConnectionTimeoutMs,
    requestTimeoutMs: config.emulatorRequestTimeoutMs,
  };

  registerHealthRoutes(app, config);
  registerConfigRoutes(app, config);
  registerServiceRoutes(app);
  registerDispatcherRoutes(app, clientOverrides, {
    maxResponseBytes: config.dispatcherMaxResponseBytes,
  });
  registerS3Routes(app, clientOverrides);
  registerEksRoutes(app, {
    ...clientOverrides,
    publicEndpoint: config.emulatorPublicEndpoint,
  });

  return app;
}
