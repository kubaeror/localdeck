import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ApiErrorCodes, type ApiErrorResponse } from '@localdeck/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { getConfig, type AppConfig } from './config.js';
import { toApiError } from './lib/errors.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerDispatcherRoutes } from './routes/dispatcher.js';
import { registerEksRoutes } from './routes/eks.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerS3Routes } from './routes/s3.js';
import { registerServiceRoutes } from './routes/services.js';

export interface BuildAppOptions {
  config?: AppConfig;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? getConfig();

  const logger: FastifyServerOptions['logger'] = options.logger ?? {
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
    ...(config.logPretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };

  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
    ajv: {
      // A proxy must reject unknown request properties instead of silently
      // dropping them (Fastify strips them by default).
      customOptions: { removeAdditional: false },
    },
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });

  // Object uploads arrive as multipart/form-data. Limits mirror S3's single
  // object maximum; the S3 upload route streams the part into S3 (switching to
  // the multipart upload API for large objects) instead of buffering it here.
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
    const apiError = toApiError(error, { endpoint: config.localstackEndpoint });

    if (apiError.statusCode >= 500) {
      request.log.error({ err: error, code: apiError.code }, 'request failed');
    } else {
      request.log.warn({ err: error, code: apiError.code }, 'request rejected');
    }

    if (reply.sent) return;
    void reply.code(apiError.statusCode).send({ error: apiError } satisfies ApiErrorResponse);
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: {
        code: ApiErrorCodes.notFound,
        message: `No LocalDeck api route matches ${request.method} ${request.url}.`,
        statusCode: 404,
      },
    } satisfies ApiErrorResponse);
  });

  registerHealthRoutes(app, config);
  registerConfigRoutes(app, config);
  registerServiceRoutes(app);
  registerDispatcherRoutes(app, {
    endpoint: config.localstackEndpoint,
    region: config.region,
  });
  registerS3Routes(app, {
    endpoint: config.localstackEndpoint,
    region: config.region,
  });
  registerEksRoutes(app, {
    endpoint: config.localstackEndpoint,
    region: config.region,
  });

  return app;
}
