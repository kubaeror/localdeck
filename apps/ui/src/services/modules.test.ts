import { SERVICE_CATALOG } from '@localdeck/shared';
import { describe, expect, it } from 'vitest';
import { getServiceModule, listDiscoveredModules, mergeServiceCatalog } from './modules';

describe('service module discovery', () => {
  it('discovers the s3 module with its pages and routes', () => {
    const s3 = getServiceModule('s3');

    expect(s3).toBeDefined();
    expect(s3?.descriptor.id).toBe('s3');
    expect(s3?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'list'],
      ['create', 'create'],
      ['buckets/:bucketName', 'detail'],
    ]);
    // Discovered modules ship their own components; the placeholder has none.
    expect(s3?.pages.list).toBeDefined();
    expect(s3?.pages.detail).toBeDefined();
    expect(s3?.pages.create).toBeDefined();
  });

  it('discovers the iam module with one page per resource view', () => {
    const iam = getServiceModule('iam');

    expect(iam).toBeDefined();
    expect(iam?.descriptor.id).toBe('iam');
    expect(iam?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'dashboard'],
      ['users', 'users'],
      ['users/create', 'user-create'],
      ['users/:userName', 'user-detail'],
      ['groups', 'groups'],
      ['groups/create', 'group-create'],
      ['groups/:groupName', 'group-detail'],
      ['roles', 'roles'],
      ['roles/create', 'role-create'],
      ['roles/:roleName', 'role-detail'],
      ['policies', 'policies'],
      ['policies/create', 'policy-create'],
      ['policies/:policyArn', 'policy-detail'],
    ]);
    // Every route has a component: the shell never falls back to the placeholder.
    for (const route of iam?.routes ?? []) {
      expect(iam?.pages[route.page], route.page).toBeDefined();
    }
  });

  it('discovers the ec2 module with one page per resource view', () => {
    const ec2 = getServiceModule('ec2');

    expect(ec2).toBeDefined();
    expect(ec2?.descriptor.id).toBe('ec2');
    expect(ec2?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'dashboard'],
      ['instances', 'instances'],
      ['instances/launch', 'instance-launch'],
      ['instances/:instanceId', 'instance-detail'],
      ['security-groups', 'security-groups'],
      ['security-groups/:groupId', 'security-group-detail'],
      ['volumes', 'volumes'],
      ['volumes/create', 'volume-create'],
      ['volumes/:volumeId', 'volume-detail'],
      ['amis', 'amis'],
      ['amis/:imageId', 'ami-detail'],
    ]);
    // Every route has a component: the shell never falls back to the placeholder.
    for (const route of ec2?.routes ?? []) {
      expect(ec2?.pages[route.page], route.page).toBeDefined();
    }
  });

  it('discovers the eks module with its pages and routes', () => {
    const eks = getServiceModule('eks');

    expect(eks).toBeDefined();
    expect(eks?.descriptor.id).toBe('eks');
    expect(eks?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'clusters'],
      ['create', 'cluster-create'],
      ['clusters/:clusterName', 'cluster-detail'],
    ]);
    // Every route has a component: the shell never falls back to the placeholder.
    for (const route of eks?.routes ?? []) {
      expect(eks?.pages[route.page], route.page).toBeDefined();
    }
  });

  it('falls back to the placeholder module for planned services', () => {
    const lightsail = getServiceModule('lightsail');

    expect(lightsail?.descriptor.id).toBe('lightsail');
    expect(lightsail?.pages).toEqual({});
    expect(lightsail?.routes).toHaveLength(1);
  });

  it('generates the resource browser for browser-parity services without a folder', () => {
    const sns = getServiceModule('sns');

    expect(sns?.descriptor.id).toBe('sns');
    expect(sns?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'list'],
      ['create', 'create'],
      ['resources/:resourceId', 'detail'],
    ]);
    expect(sns?.pages.list).toBeDefined();
    expect(sns?.pages.detail).toBeDefined();
    expect(sns?.pages.create).toBeDefined();
    // The generated module declares only the operations its browser calls.
    expect(sns?.spec.operations).toContain('ListTopics');
    expect(sns?.spec.operations).toContain('GetTopicAttributes');
    expect(sns?.spec.capabilities).toEqual({ list: true, detail: true, create: false });
  });

  it('lets a dedicated module override the generated browser', () => {
    // The registry binds a generic browser for s3 (ListBuckets, HeadBucket,
    // DeleteBucket); the hand-written module must still own its routes.
    const s3 = getServiceModule('s3');

    expect(s3?.routes.map((route) => [route.path, route.page])).toEqual([
      ['', 'list'],
      ['create', 'create'],
      ['buckets/:bucketName', 'detail'],
    ]);
    expect(s3?.spec.capabilities).toEqual({ list: true, detail: true, create: true });
  });

  it('returns nothing for ids that are neither registered nor generated', () => {
    expect(getServiceModule('not-a-service')).toBeUndefined();
  });

  it('lists the modules that have their own folder', () => {
    const discovered = listDiscoveredModules();

    expect(discovered.map((module) => module.descriptor.id)).toEqual(
      expect.arrayContaining(['s3', 'iam', 'ec2', 'eks']),
    );
    expect(discovered).toHaveLength(4);
    for (const module of discovered) {
      expect(Object.keys(module.pages).length).toBeGreaterThan(0);
    }
  });

  it('merges module descriptors into the registry (module wins)', () => {
    const merged = mergeServiceCatalog(SERVICE_CATALOG);
    const s3 = merged.find((service) => service.id === 's3');

    expect(s3).toBeDefined();
    expect(merged).toHaveLength(SERVICE_CATALOG.length);
    expect(new Set(merged.map((service) => service.id)).size).toBe(merged.length);
  });

  it('adds a module-only service that the api registry does not know yet', () => {
    // Modules contribute their descriptors, which is what makes a freshly
    // generated service appear in the sidebar before the api restarts.
    const descriptor = getServiceModule('s3')?.descriptor;
    if (descriptor === undefined) throw new Error('s3 module missing');

    const merged = mergeServiceCatalog([]);
    expect(merged.some((service) => service.id === 's3')).toBe(true);
  });
});
