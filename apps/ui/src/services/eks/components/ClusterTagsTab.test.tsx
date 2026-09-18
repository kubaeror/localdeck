// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from '../../../contexts/FlashbarProvider';
import type { EksCluster } from '../api';
import { ClusterTagsTab } from './ClusterTagsTab';

function cluster(tags: EksCluster['tags']): EksCluster {
  return {
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
    tags,
    raw: {},
  };
}

function stubEks(handler: (operation: string) => unknown): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/eks\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const operation = match[1] ?? '';
    void init;
    const result = handler(operation);
    if (typeof result === 'object' && result !== null && '__error' in result) {
      const error = (result as { __error: { code: string; message: string; statusCode: number } })
        .__error;
      return new Response(JSON.stringify({ error }), {
        status: error.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ service: 'eks', operation, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('EKS ClusterTagsTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('blocks saving more than 50 tags', () => {
    const tags = Array.from({ length: 51 }, (_value, index) => ({
      Key: `key-${index}`,
      Value: 'x',
    }));
    render(
      <FlashbarProvider>
        <ClusterTagsTab cluster={cluster(tags)} />
      </FlashbarProvider>,
    );

    expect(screen.getByText('A resource can have at most 50 tags.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('reports which keys were applied when the removal phase fails', async () => {
    stubEks((operation) => {
      if (operation === 'UntagResource') {
        return { __error: { code: 'AccessDeniedException', message: 'denied', statusCode: 403 } };
      }
      return {};
    });
    render(
      <FlashbarProvider>
        <ClusterTagsTab
          cluster={cluster([
            { Key: 'keep', Value: '1' },
            { Key: 'drop', Value: 'x' },
          ])}
        />
      </FlashbarProvider>,
    );

    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag drop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText(/Already applied: keep/)).toBeDefined();
    });
  });
});
