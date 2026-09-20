// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EksCluster } from '../api';
import { CreateNodegroupModal } from './CreateNodegroupModal';

function cluster(overrides: Partial<EksCluster> = {}): EksCluster {
  return {
    name: 'localdeck-cluster',
    status: 'ACTIVE',
    version: '1.36',
    roleArn: 'arn:aws:iam::000000000000:role/eks-role',
    vpcConfig: {
      subnetIds: ['subnet-1', 'subnet-2'],
      securityGroupIds: [],
      endpointPublicAccess: true,
      endpointPrivateAccess: false,
      publicAccessCidrs: ['0.0.0.0/0'],
    },
    tags: [],
    raw: {},
    ...overrides,
  };
}

interface Call {
  service: string;
  operation: string;
  input: Record<string, unknown>;
}

function stubDispatcher(handler: (service: string, operation: string) => unknown): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/([^/?]+)\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const service = match[1] ?? '';
    const operation = match[2] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    calls.push({ service, operation, input: body.input ?? {} });
    return new Response(
      JSON.stringify({ service, operation, result: handler(service, operation) }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderModal(target: EksCluster = cluster()): {
  onCreated: ReturnType<typeof vi.fn>;
  rerender: (next: EksCluster) => void;
} {
  const onCreated = vi.fn();
  const { rerender } = render(
    <CreateNodegroupModal
      visible
      cluster={target}
      onDismiss={() => undefined}
      onCreated={onCreated}
    />,
  );
  return {
    onCreated,
    rerender: (next: EksCluster) => {
      rerender(
        <CreateNodegroupModal
          visible
          cluster={next}
          onDismiss={() => undefined}
          onCreated={onCreated}
        />,
      );
    },
  };
}

const NAME_PLACEHOLDER = 'standard-workers';
const ROLE_PLACEHOLDER = 'arn:aws:iam::000000000000:role/eks-cluster-role';

async function fillRequiredFields(): Promise<void> {
  await screen.findByText('t3.medium');
  fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
    target: { value: 'ng-workers' },
  });
  const roleInput = await screen.findByPlaceholderText(ROLE_PLACEHOLDER);
  fireEvent.change(roleInput, {
    target: { value: 'arn:aws:iam::000000000000:role/node-role' },
  });
}

/**
 * Answers CreateNodegroup only after `release()` is called, so a test can
 * click Create while the first request is still in flight.
 */
function stubDeferredCreate(): { calls: Call[]; release: () => void } {
  const calls: Call[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const match = /\/api\/services\/([^/?]+)\/([^/?]+)/.exec(url);
    if (match === null) return new Response('{}', { status: 404 });
    const service = match[1] ?? '';
    const operation = match[2] ?? '';
    const body =
      init?.body === undefined
        ? {}
        : (JSON.parse(String(init.body)) as { input?: Record<string, unknown> });
    calls.push({ service, operation, input: body.input ?? {} });
    if (service === 'ec2' && operation === 'DescribeInstanceTypes') {
      return new Response(
        JSON.stringify({
          service,
          operation,
          result: { InstanceTypes: [{ InstanceType: 't3.medium' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (service === 'iam' && operation === 'ListRoles') {
      return new Response(JSON.stringify({ service, operation, result: { Roles: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (service === 'eks' && operation === 'CreateNodegroup' && !held) {
      held = true;
      await gate;
    }
    return new Response(
      JSON.stringify({
        service,
        operation,
        result: { nodegroup: { nodegroupName: 'ng-workers', status: 'CREATING' } },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, release };
}

describe('EKS CreateNodegroupModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('submits labels and tags with the create request', async () => {
    const calls = stubDispatcher((service, operation) => {
      if (service === 'ec2' && operation === 'DescribeInstanceTypes') {
        return { InstanceTypes: [{ InstanceType: 't3.medium' }] };
      }
      if (service === 'iam' && operation === 'ListRoles') return { Roles: [] };
      if (service === 'eks' && operation === 'CreateNodegroup') {
        return { nodegroup: { nodegroupName: 'ng-workers', status: 'CREATING' } };
      }
      return {};
    });
    const { onCreated } = renderModal();
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Add label' }));
    fireEvent.change(screen.getAllByLabelText('Tag key 1')[0] as HTMLElement, {
      target: { value: 'team' },
    });
    fireEvent.change(screen.getAllByLabelText('Tag value 1')[0] as HTMLElement, {
      target: { value: 'platform' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    fireEvent.change(screen.getAllByLabelText('Tag key 1')[1] as HTMLElement, {
      target: { value: 'env' },
    });
    fireEvent.change(screen.getAllByLabelText('Tag value 1')[1] as HTMLElement, {
      target: { value: 'local' },
    });

    const create = screen.getByRole('button', { name: 'Create' });
    expect(create.hasAttribute('disabled')).toBe(false);
    fireEvent.click(create);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    const call = calls.find((entry) => entry.operation === 'CreateNodegroup');
    expect(call?.input).toMatchObject({
      clusterName: 'localdeck-cluster',
      nodegroupName: 'ng-workers',
      nodeRole: 'arn:aws:iam::000000000000:role/node-role',
      labels: { team: 'platform' },
      tags: { env: 'local' },
    });
  }, 20_000);

  it('blocks Create while a tag row has no key', async () => {
    stubDispatcher((service, operation) => {
      if (service === 'ec2' && operation === 'DescribeInstanceTypes') {
        return { InstanceTypes: [{ InstanceType: 't3.medium' }] };
      }
      if (service === 'iam' && operation === 'ListRoles') return { Roles: [] };
      return {};
    });
    renderModal();
    await fillRequiredFields();

    const create = screen.getByRole('button', { name: 'Create' });
    expect(create.hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add new tag' }));
    const emptyKeyErrors = screen.getAllByText('Tag keys cannot be empty or whitespace.');
    expect(emptyKeyErrors.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
  }, 20_000);

  it('keeps the user subnet edits when the cluster refreshes, reseeding on a new cluster', async () => {
    stubDispatcher((service, operation) => {
      if (service === 'ec2' && operation === 'DescribeInstanceTypes') {
        return { InstanceTypes: [{ InstanceType: 't3.medium' }] };
      }
      if (service === 'iam' && operation === 'ListRoles') return { Roles: [] };
      return {};
    });
    const { rerender } = renderModal();
    await screen.findByText('t3.medium');

    expect(screen.queryAllByText('subnet-1').length).toBeGreaterThan(0);

    // A background refresh (same cluster, new arrays) must not reset the form.
    rerender(cluster({ vpcConfig: { ...cluster().vpcConfig, subnetIds: ['subnet-1'] } }));
    expect(screen.queryAllByText('subnet-1').length).toBeGreaterThan(0);

    // Pointing the modal at another cluster reseeds the subnets.
    rerender(
      cluster({
        name: 'other-cluster',
        vpcConfig: { ...cluster().vpcConfig, subnetIds: ['subnet-9'] },
      }),
    );
    await waitFor(() => {
      expect(screen.queryAllByText('subnet-9').length).toBeGreaterThan(0);
    });
  }, 20_000);

  it('dispatches one CreateNodegroup when Create is double-clicked', async () => {
    const { calls, release } = stubDeferredCreate();
    const { onCreated } = renderModal();
    await fillRequiredFields();

    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    fireEvent.click(create);

    expect(calls.filter((entry) => entry.operation === 'CreateNodegroup')).toHaveLength(1);
    release();
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
  }, 20_000);
});
