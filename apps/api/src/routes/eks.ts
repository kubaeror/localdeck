import { API_PATHS, ApiErrorCodes } from '@localdeck/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AwsClientConfigOverrides } from '../lib/awsClients.js';
import { ApiProblem } from '../lib/errors.js';
import { clientDisconnectSignal } from '../lib/http.js';
import { buildKubeconfig, kubeconfigFileName } from '../lib/kubeconfig.js';
import { dispatchServiceOperation } from '../registry/dispatcher.js';

/**
 * Dedicated EKS route: `GET /api/eks/:cluster/kubeconfig`.
 *
 * The YAML cannot travel through the generic JSON dispatcher, so this route
 * describes the cluster with the same dispatcher (and therefore the same
 * whitelist and SDK client factory) and renders the kubeconfig itself. It
 * never talks to the Kubernetes API: the file is exactly what
 * `aws eks update-kubeconfig` would write for the cluster it just described.
 */

/** The DescribeCluster members this route reads. */
interface DescribedCluster {
  name?: string;
  arn?: string;
  status?: string;
  endpoint?: string;
  certificateAuthority?: { data?: string };
}

interface KubeconfigParams {
  cluster: string;
}

export interface EksRouteOptions extends AwsClientConfigOverrides {
  /**
   * Endpoint the generated kubeconfig points the `aws eks get-token` plugin at.
   * Defaults to the api's configured endpoint. Set
   * `LOCALSTACK_PUBLIC_ENDPOINT` when the api runs in Docker
   * (`host.docker.internal`) but kubectl runs on the Docker host, where that
   * hostname does not resolve.
   */
  publicEndpoint?: string;
}

const KUBECONFIG_QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

function requireString(value: unknown, label: string, cluster: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiProblem({
      code: ApiErrorCodes.clusterNotReady,
      statusCode: 409,
      message:
        `LocalStack did not report the ${label} for the EKS cluster "${cluster}", so a ` +
        'kubeconfig cannot be built yet. Wait until the cluster is ACTIVE and download it again.',
      service: 'eks',
      details: { cluster, missing: label },
    });
  }
  return value;
}

/**
 * Registers the EKS kubeconfig route. `options` carries the endpoint and
 * region the running app was configured with, so the DescribeCluster call and
 * the credential plugin agree with `/api/health`, plus the public endpoint that
 * is safe to embed in a file used outside the container network.
 */
export function registerEksRoutes(app: FastifyInstance, options: EksRouteOptions = {}): void {
  const clientOverrides: AwsClientConfigOverrides = {
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    ...(options.region === undefined ? {} : { region: options.region }),
    ...(options.connectionTimeoutMs === undefined
      ? {}
      : { connectionTimeoutMs: options.connectionTimeoutMs }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
  };
  const publicEndpoint = options.publicEndpoint ?? options.endpoint ?? '';

  app.get<{ Params: KubeconfigParams }>(
    API_PATHS.eksKubeconfig,
    {
      schema: {
        params: {
          type: 'object',
          required: ['cluster'],
          additionalProperties: false,
          properties: {
            // EKS cluster names: alphanumerics, hyphens and underscores.
            cluster: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[0-9A-Za-z_-]+$' },
          },
        },
        querystring: KUBECONFIG_QUERY_SCHEMA,
      },
    },
    async (request, reply): Promise<void> => {
      const { cluster: clusterName } = request.params;
      const response = await dispatchServiceOperation(
        'eks',
        'DescribeCluster',
        { name: clusterName },
        clientOverrides,
        { signal: clientDisconnectSignal(reply) },
      );
      const described = (response.result as { cluster?: DescribedCluster }).cluster;
      if (described === undefined) {
        throw new ApiProblem({
          code: ApiErrorCodes.notFound,
          statusCode: 404,
          message: `LocalStack returned no EKS cluster named "${clusterName}".`,
          service: 'eks',
          details: { cluster: clusterName },
        });
      }

      if (described.status !== 'ACTIVE') {
        throw new ApiProblem({
          code: ApiErrorCodes.clusterNotReady,
          statusCode: 409,
          message:
            `The EKS cluster "${clusterName}" is ${described.status ?? 'in an unknown state'}. ` +
            'A kubeconfig can only be downloaded once the cluster is ACTIVE.',
          service: 'eks',
          details: { cluster: clusterName, status: described.status ?? null },
        });
      }

      const endpoint = requireString(described.endpoint, 'Kubernetes API endpoint', clusterName);
      const certificateAuthorityData = requireString(
        described.certificateAuthority?.data,
        'certificate authority data',
        clusterName,
      );

      const yaml = buildKubeconfig({
        cluster: {
          name: described.name ?? clusterName,
          arn: described.arn ?? '',
          endpoint,
          certificateAuthorityData,
        },
        region: clientOverrides.region ?? 'us-east-1',
        localstackEndpoint: publicEndpoint,
      });

      request.log.info(
        { cluster: clusterName, endpoint, kubeconfigEndpoint: publicEndpoint },
        'eks kubeconfig generated from DescribeCluster',
      );
      sendKubeconfig(reply, kubeconfigFileName(clusterName), yaml, publicEndpoint);
    },
  );
}

/** One place for the download headers, so the ui can rely on them. */
function sendKubeconfig(
  reply: FastifyReply,
  fileName: string,
  yaml: string,
  publicEndpoint: string,
): void {
  void reply.header('content-type', 'application/yaml; charset=utf-8');
  void reply.header('content-disposition', `attachment; filename="${fileName}"`);
  void reply.header('cache-control', 'no-store');
  // Provenance for the console and the live verification script.
  void reply.header('x-localdeck-kubeconfig', 'describe-cluster');
  if (publicEndpoint.length > 0) {
    void reply.header('x-localdeck-kubeconfig-endpoint', publicEndpoint);
  }
  void reply.send(yaml);
}
