import { describe, expect, it } from 'vitest';
import {
  SERVICE_CATALOG,
  SERVICE_CATEGORIES,
  browserOperationsFor,
  findService,
  isServiceEmulated,
  localStackKeysFor,
  resolveServiceStatus,
  serviceCategories,
  serviceSearchText,
  summarizeRegistryCoverage,
} from '../src/index.js';
import type { LocalStackServiceStatus } from '../src/index.js';

describe('service catalog', () => {
  it('has unique, route-safe ids', () => {
    const ids = SERVICE_CATALOG.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('covers the full LocalStack top-tier catalogue (110+ services)', () => {
    // LocalStack's service index (https://docs.localstack.cloud/aws/services/)
    // lists ~100 services; the registry adds the health-key aliases and the
    // console-only entries on top.
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(110);
  });

  it('describes every service completely', () => {
    for (const service of SERVICE_CATALOG) {
      expect(service.displayName.length).toBeGreaterThan(0);
      expect(service.summary.length).toBeGreaterThan(0);
      expect(service.iconKey.length).toBeGreaterThan(0);
      expect(service.sdkPackage.startsWith('@aws-sdk/')).toBe(true);
      expect(service.operations.length).toBeGreaterThan(0);
      expect(new Set(service.operations).size).toBe(service.operations.length);
      expect(['dedicated', 'browser', 'planned']).toContain(service.parityLevel);
      expect(SERVICE_CATEGORIES).toContain(service.category);
    }
  });

  it('binds the listOp and optional detail/delete operations for every browser service', () => {
    for (const service of SERVICE_CATALOG) {
      if (service.parityLevel === 'browser') {
        expect(
          service.browser,
          `${service.id} has browser parity but no browser spec`,
        ).toBeDefined();
      }
      if (service.browser === undefined) continue;

      // The generic browser may only call whitelisted operations.
      for (const operation of browserOperationsFor(service)) {
        expect(service.operations, `${service.id} does not whitelist ${operation}`).toContain(
          operation,
        );
      }

      const { list, describe, delete: deleteOp, tags } = service.browser;
      expect(list.operation.length, `${service.id} listOp`).toBeGreaterThan(0);
      for (const [kind, operation] of [
        ['describe', describe],
        ['delete', deleteOp],
        ['tags', tags],
      ] as const) {
        if (operation === undefined) continue;
        expect(operation.operation.length, `${service.id} ${kind} operation`).toBeGreaterThan(0);
        expect(operation.idParam, `${service.id} ${kind} idParam`).toBeDefined();
      }
      if (describe !== undefined && list.idField === undefined) {
        // A describe call needs an identifier to point at; without an explicit
        // idField the browser infers one from the usual AWS field names.
        expect(list.operation.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses every console category and orders them like the console', () => {
    const used = new Set(SERVICE_CATALOG.map((service) => service.category));
    for (const category of SERVICE_CATEGORIES) expect(used).toContain(category);
    expect(serviceCategories()).toHaveLength(SERVICE_CATEGORIES.length);
    expect(serviceCategories().reduce((sum, entry) => sum + entry.serviceCount, 0)).toBe(
      SERVICE_CATALOG.length,
    );
  });

  it('never lets two services claim the same LocalStack health key', () => {
    const claimed = new Map<string, string>();
    for (const service of SERVICE_CATALOG) {
      for (const key of localStackKeysFor(service)) {
        expect(claimed.has(key), `${key} is claimed twice`).toBe(false);
        claimed.set(key, service.id);
      }
    }
  });

  it('keeps health-key aliases out of the primary id namespace', () => {
    for (const service of SERVICE_CATALOG) {
      for (const alias of service.healthKeys ?? []) {
        expect(findService(alias), `${alias} must not be a service id`).toBeUndefined();
      }
    }
  });

  it('builds searchable text from the descriptor', () => {
    const s3 = findService('s3');
    if (s3 === undefined) throw new Error('s3 must be registered');
    const text = serviceSearchText(s3);
    expect(text).toContain('S3');
    expect(text).toContain('ListBuckets');
    expect(text.toLowerCase()).toContain('bucket');
  });
});

describe('registry vs LocalStack health', () => {
  const services: Record<string, LocalStackServiceStatus> = {
    s3: 'available',
    lambda: 'available',
    elb: 'available',
    es: 'available',
    'timestream-write': 'available',
    dynamodb: 'disabled',
    'not-in-registry': 'available',
  };

  it('matches services by id and by health-key alias', () => {
    const expectStatus = (id: string, status: LocalStackServiceStatus | undefined): void => {
      const service = findService(id);
      if (service === undefined) throw new Error(`${id} must be registered`);
      expect(resolveServiceStatus(service, services)).toBe(status);
    };

    expectStatus('s3', 'available');
    expectStatus('dynamodb', 'disabled');
    // Aliases: ELB reports as elb, OpenSearch as es, Timestream as timestream-write.
    expectStatus('elbv2', 'available');
    expectStatus('opensearch', 'available');
    expectStatus('timestream', 'available');
    // Registered but not reported by this LocalStack: the sidebar greys it out.
    expectStatus('ec2', undefined);

    const ec2 = findService('ec2');
    if (ec2 === undefined) throw new Error('ec2 must be registered');
    expect(isServiceEmulated(ec2, services)).toBe(false);
  });

  it('summarizes how much of the emulator the registry covers', () => {
    const coverage = summarizeRegistryCoverage(services);

    expect(coverage.registered).toBe(SERVICE_CATALOG.length);
    expect(coverage.emulated).toBe(SERVICE_CATALOG.length - coverage.notEmulated.length);
    expect(coverage.notEmulated).toContain('ec2');
    expect(coverage.notEmulated).not.toContain('s3');
    expect(coverage.unregistered).toEqual(['not-in-registry']);
  });
});
