import { SERVICE_CATALOG } from '@localdeck/shared';
import { describe, expect, it } from 'vitest';
import {
  isSdkPackageInstalled,
  isServiceAvailable,
  resetSdkAvailabilityCache,
  withAvailability,
} from '../src/registry/sdkAvailability.js';

function descriptor(id: string) {
  const service = SERVICE_CATALOG.find((entry) => entry.id === id);
  if (service === undefined) throw new Error(`${id} must be in the registry`);
  return service;
}

describe('sdk package availability (API-004 / LD-02)', () => {
  it('resolves installed packages and rejects a fake missing one', () => {
    expect(isSdkPackageInstalled('@aws-sdk/client-s3')).toBe(true);
    expect(isSdkPackageInstalled('@aws-sdk/client-localdeck-does-not-exist')).toBe(false);
  });

  it('marks planned services unavailable even when their package resolves', () => {
    const sts = descriptor('sts');
    // @aws-sdk/client-sts is installed for the dedicated flows, but the
    // service is a navigation placeholder in LocalDeck.
    expect(isSdkPackageInstalled(sts.sdkPackage)).toBe(true);
    expect(sts.parityLevel).toBe('planned');
    expect(isServiceAvailable(sts)).toBe(false);
    expect(withAvailability(sts).available).toBe(false);
  });

  it('marks browser services without their SDK installed as unavailable', () => {
    const batch = descriptor('batch');
    expect(isServiceAvailable(batch)).toBe(false);
    expect(withAvailability(batch)).toMatchObject({ id: 'batch', available: false });
  });

  it('keeps the bundled catalog free of a runtime availability claim', () => {
    for (const service of SERVICE_CATALOG) {
      expect(service.available).toBeUndefined();
    }
  });

  it('caches resolutions per package and clears them on reset', () => {
    resetSdkAvailabilityCache();
    expect(isSdkPackageInstalled('@aws-sdk/client-s3')).toBe(true);
    expect(isSdkPackageInstalled('@aws-sdk/client-s3')).toBe(true);
    resetSdkAvailabilityCache();
    expect(isSdkPackageInstalled('@aws-sdk/client-s3')).toBe(true);
  });
});
