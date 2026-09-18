import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { destroyAwsClients } from './lib/awsClients.js';
import { createShutdownHandler } from './lib/shutdown.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp({ config });

  const shutdown = createShutdownHandler({
    log: (message, fields) => {
      app.log.info(fields ?? {}, message);
    },
    closeApp: () => app.close(),
    destroyClients: destroyAwsClients,
    exit: (code) => {
      process.exitCode = code;
      process.exit(code);
    },
    timeoutMs: config.shutdownTimeoutMs,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled rejection');
  });

  process.on('uncaughtException', (error) => {
    app.log.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    {
      environment: config.environment,
      localstackEndpoint: config.localstackEndpoint,
      localstackPublicEndpoint: config.localstackPublicEndpoint,
      region: config.region,
      requestTimeoutMs: config.localstackRequestTimeoutMs,
      healthUrl: config.localstackHealthUrl,
    },
    'LocalDeck api ready',
  );
}

void main().catch((error: unknown) => {
  console.error('[localdeck-api] failed to start', error);
  process.exit(1);
});
