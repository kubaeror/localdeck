// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EksCluster, EksNodegroup } from '../api';
import { UpdateScalingModal } from './UpdateScalingModal';

const CLUSTER: EksCluster = {
  name: 'localdeck-cluster',
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

const NODEGROUP: EksNodegroup = {
  nodegroupName: 'ng-workers',
  clusterName: 'localdeck-cluster',
  status: 'ACTIVE',
  instanceTypes: ['t3.medium'],
  nodeRole: 'arn:aws:iam::000000000000:role/node-role',
  subnets: ['subnet-1'],
  scaling: { minSize: 1, maxSize: 2, desiredSize: 1 },
  autoScalingGroups: [],
  labels: {},
  healthIssues: [],
  tags: [],
  raw: {},
};

interface Call {
  operation: string;
  input: Record<string, unknown>;
}

function stubUpdate(handler: (input: Record<string, unknown>) => unknown): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/eks\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    const operationInput = body.input ?? {};
    calls.push({ operation, input: operationInput });
    return new Response(
      JSON.stringify({
        service: 'eks',
        operation,
        result: handler(operationInput),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderModal(): { onUpdated: ReturnType<typeof vi.fn> } {
  const onUpdated = vi.fn();
  render(
    <UpdateScalingModal
      visible
      cluster={CLUSTER}
      nodegroup={NODEGROUP}
      onDismiss={() => undefined}
      onUpdated={onUpdated}
    />,
  );
  return { onUpdated };
}

/**
 * Answers UpdateNodegroupConfig only after `release()` is called, so a test
 * can click Save while the first request is still in flight.
 */
function stubDeferredUpdate(): { calls: Call[]; release: () => void } {
  const calls: Call[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/eks\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const operation = match[1] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    calls.push({ operation, input: body.input ?? {} });
    if (operation === 'UpdateNodegroupConfig' && !held) {
      held = true;
      await gate;
    }
    return new Response(
      JSON.stringify({
        service: 'eks',
        operation,
        result: {
          nodegroup: {
            ...NODEGROUP.raw,
            nodegroupName: 'ng-workers',
            scalingConfig: { minSize: 1, maxSize: 5, desiredSize: 2 },
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, release };
}

describe('EKS UpdateScalingModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sends the edited scaling configuration through UpdateNodegroupConfig', async () => {
    const calls = stubUpdate(() => ({
      nodegroup: {
        ...NODEGROUP.raw,
        nodegroupName: 'ng-workers',
        scalingConfig: { minSize: 1, maxSize: 5, desiredSize: 2 },
      },
    }));
    const { onUpdated } = renderModal();

    fireEvent.change(screen.getByLabelText('Maximum size'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Desired size'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });
    expect(calls[0]?.operation).toBe('UpdateNodegroupConfig');
    expect(calls[0]?.input).toEqual({
      clusterName: 'localdeck-cluster',
      nodegroupName: 'ng-workers',
      scalingConfig: { minSize: 1, maxSize: 5, desiredSize: 2 },
    });
    expect(onUpdated.mock.calls[0]?.[0]).toMatchObject({
      scaling: { minSize: 1, maxSize: 5, desiredSize: 2 },
    });
  });

  it('blocks submit on inconsistent or non-integer values', () => {
    stubUpdate(() => ({}));
    renderModal();

    // desired > max
    fireEvent.change(screen.getByLabelText('Desired size'), { target: { value: '9' } });
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(
      true,
    );

    // parseInt would accept 3.9; the strict parser must not.
    fireEvent.change(screen.getByLabelText('Desired size'), { target: { value: '3.9' } });
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('dispatches one update when Save changes is double-clicked', async () => {
    const { calls, release } = stubDeferredUpdate();
    const { onUpdated } = renderModal();

    fireEvent.change(screen.getByLabelText('Maximum size'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Desired size'), { target: { value: '2' } });
    const save = screen.getByRole('button', { name: 'Save changes' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(calls).toHaveLength(1);
    release();
    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });
  });
});
