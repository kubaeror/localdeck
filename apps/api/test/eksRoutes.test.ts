import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ApiErrorResponse } from '@localdeck/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildKubeconfig, kubeconfigFileName } from '../src/lib/kubeconfig.js';

interface StubEks {
  url: string;
  /** Paths the SDK requested, proving the cluster name reached LocalStack. */
  requests: string[];
  close: () => Promise<void>;
}

const ACTIVE_CLUSTER = {
  name: 'localdeck-cluster',
  arn: 'arn:aws:eks:us-east-1:000000000000:cluster/localdeck-cluster',
  status: 'ACTIVE',
  version: '1.36',
  endpoint: 'https://localhost.localstack.cloud:4513',
  certificateAuthority: { data: 'bG9jYWxkZWNrLWNh' },
};

/** Minimal EKS REST-JSON stub: GET /clusters/<name> answers with a cluster. */
async function startStubEks(): Promise<StubEks> {
  const requests: string[] = [];
  let payload: Record<string, unknown> = { cluster: ACTIVE_CLUSTER };

  const server: Server = createServer((request, response) => {
    requests.push(`${request.method ?? ''} ${request.url ?? ''}`);
    if (request.method === 'GET' && request.url === '/clusters/missing-cluster') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          message: 'No cluster found for name: missing-cluster.',
          __type: 'ResourceNotFoundException',
        }),
      );
      return;
    }
    if (request.method === 'GET' && request.url === '/clusters/creating-cluster') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ cluster: { ...ACTIVE_CLUSTER, status: 'CREATING' } }));
      return;
    }
    if (request.method === 'GET' && request.url?.startsWith('/clusters/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the EKS stub failed to bind a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      payload = { cluster: ACTIVE_CLUSTER };
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

describe('buildKubeconfig', () => {
  const cluster = {
    name: 'demo',
    arn: 'arn:aws:eks:us-east-1:000000000000:cluster/demo',
    endpoint: 'https://localhost.localstack.cloud:4513',
    certificateAuthorityData: 'bG9jYWxkZWNrLWNh',
  };

  it('renders the AWS CLI kubeconfig shape with the LocalStack endpoint', () => {
    const yaml = buildKubeconfig({
      cluster,
      region: 'us-east-1',
      localstackEndpoint: 'http://localhost:4566',
    });

    expect(yaml).toContain('apiVersion: v1');
    expect(yaml).toContain('kind: Config');
    expect(yaml).toContain(`current-context: "arn:aws:eks:us-east-1:000000000000:cluster/demo"`);
    expect(yaml).toContain('server: "https://localhost.localstack.cloud:4513"');
    expect(yaml).toContain('certificate-authority-data: "bG9jYWxkZWNrLWNh"');
    expect(yaml).toContain('command: aws');
    expect(yaml).toContain('- get-token');
    expect(yaml).toContain('- --cluster-name');
    expect(yaml).toContain('- "demo"');
    expect(yaml).toContain('name: AWS_ENDPOINT_URL');
    expect(yaml).toContain('value: "http://localhost:4566"');
    expect(yaml).toContain('apiVersion: client.authentication.k8s.io/v1beta1');
  });

  it('adds an AWS_PROFILE override when one is configured', () => {
    const yaml = buildKubeconfig({
      cluster,
      region: 'eu-central-1',
      localstackEndpoint: 'http://127.0.0.1:4566',
      profile: 'localstack',
    });
    expect(yaml).toContain('name: AWS_PROFILE');
    expect(yaml).toContain('value: "localstack"');
  });

  it('escapes double quotes when the endpoint contains them', () => {
    const yaml = buildKubeconfig({
      cluster: { ...cluster, endpoint: 'https://weird"host' },
      region: 'us-east-1',
      localstackEndpoint: 'http://localhost:4566',
    });
    expect(yaml).toContain('server: "https://weird\\"host"');
  });

  it('derives a safe file name from the cluster name', () => {
    expect(kubeconfigFileName('localdeck-cluster')).toBe('kubeconfig-localdeck-cluster.yaml');
    expect(kubeconfigFileName('../../etc/passwd')).toBe('kubeconfig-etc-passwd.yaml');
  });
});

describe('GET /api/eks/:cluster/kubeconfig', () => {
  let stub: StubEks;
  let app: FastifyInstance;

  beforeAll(async () => {
    stub = await startStubEks();
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'test',
        LOCALSTACK_ENDPOINT: stub.url,
        AWS_REGION: 'us-east-1',
      }),
      logger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  it('downloads a kubeconfig built from DescribeCluster', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/eks/localdeck-cluster/kubeconfig',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/yaml');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="kubeconfig-localdeck-cluster.yaml"',
    );
    expect(response.headers['x-localdeck-kubeconfig']).toBe('describe-cluster');
    expect(response.body).toContain('server: "https://localhost.localstack.cloud:4513"');
    expect(response.body).toContain('certificate-authority-data: "bG9jYWxkZWNrLWNh"');
    // The cluster name reached LocalStack as a path parameter.
    expect(stub.requests.some((line) => line.includes('/clusters/localdeck-cluster'))).toBe(true);
  });

  it('answers 409 with a clean ApiError while the cluster is not ACTIVE', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/eks/creating-cluster/kubeconfig',
    });

    expect(response.statusCode).toBe(409);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('CLUSTER_NOT_READY');
    expect(body.error.service).toBe('eks');
    expect(body.error.message).toContain('ACTIVE');
    expect(JSON.stringify(body.error.details)).toContain('CREATING');
  });

  it('surfaces DescribeCluster failures through the shared error contract', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/eks/missing-cluster/kubeconfig',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json<ApiErrorResponse>();
    expect(body.error.code).toBe('ResourceNotFoundException');
  });

  it('validates the cluster name before touching LocalStack', async () => {
    const requestsBefore = stub.requests.length;
    const response = await app.inject({
      method: 'GET',
      url: '/api/eks/not%20a%20cluster/kubeconfig',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ApiErrorResponse>().error.code).toBe('VALIDATION_FAILED');
    expect(stub.requests).toHaveLength(requestsBefore);
  });
});
