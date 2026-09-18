import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactElement } from 'react';
import { useFlashbar } from '../../../hooks/useFlashbar';
import { useLocalStackStatus } from '../../../hooks/useLocalStackStatus';
import { downloadKubeconfig, kubeconfigFileName, type EksCluster } from '../api';
import { toFriendlyEksError } from '../errors';
import { kubeconfigCommands } from './connectCommands';

export interface ConnectLocallyProps {
  cluster: EksCluster;
}

/**
 * Fallbacks used only while the live LocalStack status is still loading (or
 * when the api has not answered `/api/config` yet). The command block always
 * prefers the endpoint and region the ui is actually configured against.
 */
const FALLBACK_ENDPOINT = 'http://localhost:4566';
const FALLBACK_REGION = 'us-east-1';

/**
 * The "Connect locally" info box on the cluster overview: download the
 * kubeconfig the api builds from DescribeCluster, then open the cluster with
 * kubectl, k9s or Headlamp. The endpoint and CA come from the live cluster, so
 * the file works against this LocalStack instance without further setup.
 */
export function ConnectLocally({ cluster }: ConnectLocallyProps): ReactElement {
  const flashbar = useFlashbar();
  const status = useLocalStackStatus();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = cluster.status === 'ACTIVE';
  const endpoint = status.config?.localstack.endpoint ?? FALLBACK_ENDPOINT;
  const region = status.config?.localstack.region ?? FALLBACK_REGION;

  const download = async (): Promise<void> => {
    setDownloading(true);
    setError(null);
    try {
      await downloadKubeconfig(cluster.name);
      flashbar.notify({
        type: 'success',
        header: 'Kubeconfig downloaded',
        content: `${kubeconfigFileName(cluster.name)} describes the API endpoint and certificate authority of ${cluster.name}.`,
      });
    } catch (caught) {
      setError(toFriendlyEksError(caught).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Use the same kubectl workflow you use against real EKS. LocalStack exposes the k3d cluster through the endpoint in DescribeCluster."
        >
          Connect locally
        </Header>
      }
    >
      <SpaceBetween size="m">
        {error === null ? null : <Alert type="error">{error}</Alert>}

        {ready ? null : (
          <Alert type="info">
            The kubeconfig can be downloaded once the cluster is ACTIVE. {cluster.name} is currently{' '}
            <Box variant="strong" display="inline">
              {cluster.status}
            </Box>
            ; this page keeps refreshing while it settles.
          </Alert>
        )}

        <SpaceBetween direction="horizontal" size="s">
          <Button
            variant="primary"
            iconName="download"
            loading={downloading}
            disabled={!ready}
            onClick={() => {
              void download();
            }}
          >
            Download kubeconfig
          </Button>
          <Button href="https://k9scli.io/" target="_blank" external>
            k9s
          </Button>
          <Button href="https://headlamp.dev/" target="_blank" external>
            Headlamp
          </Button>
        </SpaceBetween>

        <Box variant="code">
          <pre style={{ margin: 0, overflowX: 'auto' }}>
            {kubeconfigCommands(cluster.name, endpoint, region)}
          </pre>
        </Box>

        <Box variant="small" color="text-body-secondary">
          The kubeconfig authenticates through{' '}
          <Box variant="code" display="inline">
            aws eks get-token
          </Box>{' '}
          (the same credential plugin the AWS CLI writes), pinned to your LocalStack endpoint. The
          AWS CLI v2 must be on your PATH; use the dummy credentials your LocalStack accepts. See{' '}
          <Link
            href="https://docs.localstack.cloud/aws/services/eks/"
            external
            externalIconAriaLabel="Opens in a new tab"
          >
            LocalStack's EKS documentation
          </Link>{' '}
          for k3d requirements and supported Kubernetes versions.
        </Box>
      </SpaceBetween>
    </Container>
  );
}

export default ConnectLocally;
