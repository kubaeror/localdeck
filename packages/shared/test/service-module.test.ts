import { describe, expect, it } from 'vitest';
import {
  SERVICE_CATALOG,
  checkServiceModule,
  createServiceSpec,
  findService,
  findTagValue,
  serviceOperationPath,
  sortTags,
  type ServiceModule,
} from '../src/index.js';

describe('createServiceSpec', () => {
  it('resolves the descriptor from the registry', () => {
    const spec = createServiceSpec('s3', {
      operations: ['ListBuckets', 'CreateBucket'],
      capabilities: { list: true, create: true },
    });

    expect(spec.descriptor.id).toBe('s3');
    expect(spec.descriptor.displayName).toBe('S3');
    expect(spec.descriptor.parityLevel).toBe('dedicated');
    expect(spec.operations).toEqual(['ListBuckets', 'CreateBucket']);
    expect(spec.capabilities).toEqual({ list: true, detail: false, create: true });
  });

  it('accepts a descriptor for services that are not in the registry', () => {
    const descriptor = {
      id: 'custom-service',
      displayName: 'Custom',
      category: 'Compute' as const,
      sdkPackage: '@aws-sdk/client-custom',
      iconKey: 'ec2',
      operations: ['ListThings'],
      parityLevel: 'browser' as const,
      summary: 'A hand-written service module.',
    };
    const spec = createServiceSpec(descriptor, { operations: ['ListThings'] });
    expect(spec.descriptor.id).toBe('custom-service');
  });

  it('refuses operations the api would reject', () => {
    expect(() => createServiceSpec('s3', { operations: ['DeleteEverything'] })).toThrow(
      /does not whitelist DeleteEverything/,
    );
  });

  it('refuses unknown service ids', () => {
    expect(() => createServiceSpec('not-a-service')).toThrow(/no service is registered/);
  });

  it('defaults to no operations and no capabilities', () => {
    const spec = createServiceSpec('s3');
    expect(spec.operations).toEqual([]);
    expect(spec.capabilities).toEqual({ list: false, detail: false, create: false });
  });
});

describe('checkServiceModule', () => {
  const descriptor = findService('s3');
  if (descriptor === undefined) throw new Error('s3 must be in the registry');

  const valid: ServiceModule = {
    descriptor,
    spec: createServiceSpec('s3', { operations: ['ListBuckets'], capabilities: { list: true } }),
    routes: [{ path: '', title: 'Buckets', page: 'list' }],
  };

  it('accepts a well-formed module', () => {
    expect(checkServiceModule('services/s3/index.ts', valid)).toEqual([]);
  });

  it('reports every structural problem', () => {
    const problems = checkServiceModule('services/broken/index.ts', {
      descriptor: { id: 'broken' },
      spec: { descriptor: { id: 'other' } },
      routes: [{ page: 'list' }, { path: 'create', page: 'create' }],
    });

    const messages = problems.map((problem) => problem.message).join('\n');
    expect(messages).toContain(
      'module.spec.descriptor.id "other" does not match the descriptor id "broken"',
    );
    expect(messages).toContain('a route is missing its path');
    expect(messages).toContain('route "create" is missing its title');
    expect(problems[0]?.where).toBe('services/broken/index.ts');
  });

  it('rejects non-objects and missing routes', () => {
    expect(checkServiceModule('x', null)).toHaveLength(1);
    expect(
      checkServiceModule('x', { descriptor: { id: 'a' }, spec: { descriptor: { id: 'a' } } }),
    ).toEqual([{ where: 'x', message: 'module.routes is missing' }]);
  });
});

describe('registry coverage of module contracts', () => {
  it('gives every service a registry id usable as a route segment', () => {
    for (const service of SERVICE_CATALOG) {
      expect(serviceOperationPath(service.id, service.operations[0] ?? 'List')).toMatch(
        /^\/api\/services\/[a-z0-9-]+\/[A-Za-z0-9]+$/,
      );
    }
  });
});

describe('AWS tags', () => {
  const tags = [
    { Key: 'Team', Value: 'platform' },
    { Key: 'Env', Value: 'local' },
  ];

  it('looks tags up by key', () => {
    expect(findTagValue(tags, 'Env')).toBe('local');
    expect(findTagValue(tags, 'Missing')).toBeUndefined();
    expect(findTagValue(undefined, 'Env')).toBeUndefined();
  });

  it('sorts tags without mutating the input', () => {
    const sorted = sortTags(tags);
    expect(sorted.map((tag) => tag.Key)).toEqual(['Env', 'Team']);
    expect(tags[0]?.Key).toBe('Team');
  });
});
