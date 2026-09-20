import fastifyStatic from '@fastify/static';
import { buildApp } from '@localdeck/api/app';
import { ApiErrorCodes, type ApiErrorResponse } from '@localdeck/shared';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LocalDeck console sidecar.
 *
 * One process that serves the built ui and mounts the LocalDeck api in-process,
 * so an emulator that manages a single console container (Floci Console
 * Contract v1) can launch LocalDeck with nothing but `PORT` and
 * `AWS_ENDPOINT_URL`. The normal deployment stays two containers (apps/api +
 * apps/ui behind nginx); this entry point exists for sidecar mode.
 *
 * Contract v1 requirements implemented here:
 * - listen on 0.0.0.0:$PORT (default 4500);
 * - `GET /api/health` answers `{status:"ok"|"unavailable", endpoint, error, console}`
 *   (the api route does this when LOCALDECK_CONSOLE_CONTRACT=1; the Dockerfile
 *   sets it);
 * - the endpoint comes from EMULATOR_ENDPOINT / AWS_ENDPOINT_URL (the api
 *   config reads them), never from a hardcoded localhost;
 * - the application is served at `/` with an SPA fallback.
 */

const DEFAULT_PORT = 4500;

function resolveUiDist(): string {
  if (process.env.UI_DIST !== undefined && process.env.UI_DIST.length > 0) {
    return process.env.UI_DIST;
  }
  // dist/index.js → ../../ui/dist (apps/console/dist → apps/ui/dist)
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../ui/dist');
}

async function main(): Promise<void> {
  const uiDist = resolveUiDist();
  if (!existsSync(path.join(uiDist, 'index.html'))) {
    throw new Error(
      `The ui bundle was not found at ${uiDist}. Build @localdeck/ui first or set UI_DIST.`,
    );
  }

  // LOCALDECK_CONSOLE_CONTRACT makes /api/health answer the Floci contract
  // shape; default it on for this entry point unless the operator opted out.
  if (process.env.LOCALDECK_CONSOLE_CONTRACT === undefined) {
    process.env.LOCALDECK_CONSOLE_CONTRACT = '1';
  }

  const app = await buildApp({
    notFoundHandler: (request, reply) => {
      const url = request.raw.url ?? request.url;
      const isApiPath = url === '/api' || url.startsWith('/api/');
      if (request.method === 'GET' && !isApiPath) {
        void reply.type('text/html; charset=utf-8').sendFile('index.html');
        return;
      }
      void reply.code(404).send({
        error: {
          code: ApiErrorCodes.notFound,
          message: `No LocalDeck console route matches ${request.method} ${url}.`,
          statusCode: 404,
        },
      } satisfies ApiErrorResponse);
    },
  });

  await app.register(fastifyStatic, {
    root: uiDist,
    wildcard: false,
    index: false,
  });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received "${process.env.PORT}"`);
  }

  await app.listen({ host: '0.0.0.0', port });
  app.log.info(
    {
      uiDist,
      port,
      consoleContract: process.env.LOCALDECK_CONSOLE_CONTRACT === '1',
      emulatorEndpoint: process.env.EMULATOR_ENDPOINT ?? process.env.AWS_ENDPOINT_URL ?? null,
    },
    'LocalDeck console sidecar ready',
  );
}

void main().catch((error: unknown) => {
  console.error('[localdeck-console] failed to start', error);
  process.exit(1);
});
