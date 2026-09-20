import { describe, expect, it } from 'vitest';
import {
  SERVICE_CATALOG,
  SERVICE_CATEGORIES,
  browserOperationsFor,
  findService,
  isServiceEnabled,
  resolveServiceStatus,
  serviceCategories,
  serviceHealthKeys,
  serviceSearchText,
  summarizeRegistryCoverage,
} from '../src/index.js';
import type { EmulatorProviderId, EmulatorServiceState } from '../src/index.js';

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

  it('never lets two services claim the same health key for a provider', () => {
    const providers: readonly EmulatorProviderId[] = ['localstack', 'floci', 'ministack'];
    for (const provider of providers) {
      const claimed = new Map<string, string>();
      for (const service of SERVICE_CATALOG) {
        for (const key of serviceHealthKeys(service, provider)) {
          const owner = claimed.get(key);
          expect(
            owner,
            `${provider}: ${key} is claimed by ${owner} and ${service.id}`,
          ).toBeUndefined();
          claimed.set(key, service.id);
        }
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

describe('generic-browser pagination catalog', () => {
  function listSpec(serviceId: string) {
    const service = findService(serviceId);
    if (service?.browser === undefined) {
      throw new Error(`${serviceId} has no browser binding`);
    }
    return service.browser.list;
  }

  it('declares the non-NextToken pagination contracts explicitly', () => {
    expect(listSpec('rds').pagination).toEqual({ requestField: 'Marker', responseField: 'Marker' });
    expect(listSpec('elasticache').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'Marker',
    });
    expect(listSpec('redshift').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'Marker',
    });
    expect(listSpec('docdb').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'Marker',
    });
    expect(listSpec('neptune').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'Marker',
    });
    expect(listSpec('dms').pagination).toEqual({ requestField: 'Marker', responseField: 'Marker' });
    expect(listSpec('efs').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'NextMarker',
    });
    expect(listSpec('glacier').pagination).toEqual({
      requestField: 'marker',
      responseField: 'Marker',
    });
    expect(listSpec('lambda').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'NextMarker',
    });
    expect(listSpec('kms').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'NextMarker',
    });
    expect(listSpec('route53').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'NextMarker',
    });
    expect(listSpec('elbv2').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'NextMarker',
    });
    expect(listSpec('dynamodb').pagination).toEqual({
      requestField: 'ExclusiveStartTableName',
      responseField: 'LastEvaluatedTableName',
    });
    expect(listSpec('dynamodbstreams').pagination).toEqual({
      requestField: 'ExclusiveStartStreamArn',
      responseField: 'LastEvaluatedStreamArn',
    });
    expect(listSpec('swf').pagination).toEqual({
      requestField: 'nextPageToken',
      responseField: 'nextPageToken',
    });
    // CloudFront nests its next marker inside DistributionList.
    expect(listSpec('cloudfront').pagination).toEqual({
      requestField: 'Marker',
      responseField: 'DistributionList.NextMarker',
    });
    // Pinpoint accepts `Token` and answers with `NextToken`.
    expect(listSpec('pinpoint').pagination).toEqual({
      requestField: 'Token',
      responseField: 'NextToken',
    });
    // GetResources uses `PaginationToken` in both directions.
    expect(listSpec('resourcegroupstaggingapi').pagination).toEqual({
      requestField: 'PaginationToken',
      responseField: 'PaginationToken',
    });
    expect(listSpec('apigateway').pagination).toEqual({
      requestField: 'position',
      responseField: 'position',
    });
    expect(listSpec('wafv2').pagination).toEqual({
      requestField: 'NextMarker',
      responseField: 'NextMarker',
    });
    expect(listSpec('emr').pagination).toEqual({ requestField: 'Marker', responseField: 'Marker' });
  });

  it('declares the batch-describe unwrap for CodeBuild', () => {
    const service = findService('codebuild');
    expect(service?.browser?.describe).toMatchObject({
      operation: 'BatchGetProjects',
      resultItemField: 'projects',
    });
  });
});

describe('registry vs emulator health', () => {
  const services: Record<string, EmulatorServiceState> = {
    s3: 'enabled',
    lambda: 'enabled',
    elb: 'enabled',
    es: 'enabled',
    'timestream-write': 'enabled',
    dynamodb: 'disabled',
    'not-in-registry': 'enabled',
  };

  it('matches services by id and by health-key alias', () => {
    const expectStatus = (id: string, status: EmulatorServiceState | undefined): void => {
      const service = findService(id);
      if (service === undefined) throw new Error(`${id} must be registered`);
      expect(resolveServiceStatus(service, services, 'localstack')).toBe(status);
    };

    expectStatus('s3', 'enabled');
    expectStatus('dynamodb', 'disabled');
    // Aliases: ELB reports as elb, OpenSearch as es, Timestream as timestream-write.
    expectStatus('elbv2', 'enabled');
    expectStatus('opensearch', 'enabled');
    expectStatus('timestream', 'enabled');
    // Registered but not reported by this emulator: the sidebar greys it out.
    expectStatus('ec2', undefined);

    const ec2 = findService('ec2');
    if (ec2 === undefined) throw new Error('ec2 must be registered');
    expect(isServiceEnabled(ec2, services, 'localstack')).toBe(false);
  });

  it('summarizes how much of the emulator the registry covers', () => {
    const coverage = summarizeRegistryCoverage(services, SERVICE_CATALOG, 'localstack');

    expect(coverage.provider).toBe('localstack');
    expect(coverage.registered).toBe(SERVICE_CATALOG.length);
    expect(coverage.emulated + coverage.disabled + coverage.notEmulated.length).toBe(
      SERVICE_CATALOG.length,
    );
    expect(coverage.disabled).toBe(1);
    expect(coverage.notEmulated).toContain('ec2');
    expect(coverage.notEmulated).not.toContain('s3');
    expect(coverage.unregistered).toEqual(['not-in-registry']);
  });

  it('resolves provider aliases against canonical states', () => {
    const floci = findService('cloudwatch');
    if (floci === undefined) throw new Error('cloudwatch must be registered');
    expect(resolveServiceStatus(floci, { monitoring: 'enabled' }, 'floci')).toBe('enabled');
    expect(resolveServiceStatus(floci, { monitoring: 'disabled' }, 'floci')).toBe('disabled');
    // The same key means something else under LocalStack's vocabulary.
    expect(resolveServiceStatus(floci, { monitoring: 'enabled' }, 'localstack')).toBeUndefined();
  });
});
