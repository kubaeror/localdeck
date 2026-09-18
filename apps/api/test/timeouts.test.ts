import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { ApiErrorResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { destroyAwsClients } from '../src/lib/awsClients.js';

/**
 * An HTTP server that accepts connections and never answers. This is the
 * "hung LocalStack" scenario API-002/LD-05 guards against: without outbound
 * timeouts the dispatcher route would hang until the test timeout.
 */
interface HangingServer {
  url: string;
  requestCount: () => number;
  close: () => Promise<void>;
}

async function startHangingServer(): Promise<HangingServer> {
  let requests = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((_request, _response) => {
    // Record and deliberately never respond; the socket stays open.
    requests += 1;
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the hanging stub failed to bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requestCount: () => requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

describe('outbound SDK request timeouts (API-002 / LD-05)', () => {
  let stub: HangingServer;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startHangingServer();
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        EMULATOR_ENDPOINT: stub.url,
        EMULATOR_CONNECTION_TIMEOUT_MS: '500',
        EMULATOR_REQUEST_TIMEOUT_MS: '400',
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    destroyAwsClients();
    await stub.close();
  });

  it('aborts a hung SDK call and answers 504 EMULATOR_TIMEOUT', async () => {
    const startedAt = Date.now();
    const response = await app.inject({
      method: 'POST',
      url: '/api/services/s3/ListBuckets',
      payload: { input: {} },
    });
    const elapsed = Date.now() - startedAt;

    expect(response.statusCode).toBe(504);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('EMULATOR_TIMEOUT');
    expect(body.error.statusCode).toBe(504);
    expect(body.error.service).toBe('s3');
    // The route settled because of the timeout, not because LocalStack answered.
    expect(stub.requestCount()).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10_000);

    // A second call must not be wedged behind the first.
    const second = await app.inject({
      method: 'POST',
      url: '/api/services/s3/ListBuckets',
      payload: { input: {} },
    });
    expect(second.statusCode).toBe(504);
  });
});
