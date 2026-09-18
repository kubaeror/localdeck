import { buildApp } from './app.js';
import { getConfig } from './config.js';
import { destroyAwsClients } from './lib/awsClients.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp({ config });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      destroyAwsClients();
    } catch (error) {
      app.log.error({ err: error }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
  };

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
      region: config.region,
      healthUrl: config.localstackHealthUrl,
    },
    'LocalDeck api ready',
  );
}

void main().catch((error: unknown) => {
  console.error('[localdeck-api] failed to start', error);
  process.exit(1);
});
