import { describe, expect, it } from 'vitest';
import {
  EMULATOR_PROVIDER_IDS,
  detectEmulatorProvider,
  getEmulatorProvider,
  isApiErrorResponse,
  normalizeEmulatorServices,
  readReadyState,
  summarizeServiceStates,
} from '../src/index.js';

describe('emulator provider descriptors', () => {
  it('covers every provider id exactly once', () => {
    const ids = EMULATOR_PROVIDER_IDS.map((id) => getEmulatorProvider(id).id);
    expect(ids).toEqual([...EMULATOR_PROVIDER_IDS]);
  });

  it('maps each provider status vocabulary to the canonical states', () => {
    const localstack = getEmulatorProvider('localstack');
    expect(localstack.normalizeStatus('available')).toBe('enabled');
    expect(localstack.normalizeStatus('running')).toBe('enabled');
    expect(localstack.normalizeStatus('error')).toBe('error');

    const floci = getEmulatorProvider('floci');
    // Floci: running = enabled, available = DISABLED (inverted).
    expect(floci.normalizeStatus('running')).toBe('enabled');
    expect(floci.normalizeStatus('available')).toBe('disabled');

    const ministack = getEmulatorProvider('ministack');
    expect(ministack.normalizeStatus('available')).toBe('enabled');

    const generic = getEmulatorProvider('generic');
    expect(generic.normalizeStatus('anything')).toBe('unknown');
    expect(generic.hasServiceInventory).toBe(false);
  });

  it('fingerprints the three health documents', () => {
    const detect = (payload: Record<string, unknown>): string | undefined =>
      detectEmulatorProvider(payload)?.id;
    expect(detect({ features: {}, services: {} })).toBe('localstack');
    // LocalStack 4.x community health documents have no `features` key.
    expect(detect({ services: { s3: 'available' }, version: '4.14.0' })).toBe('localstack');
    expect(detect({ original_edition: 'floci-always-free' })).toBe('floci');
    expect(detect({ edition: 'floci-always-free' })).toBe('floci');
    expect(detect({ ready_scripts: { status: 'completed' } })).toBe('ministack');
    expect(detect({ unexpected: true })).toBeUndefined();
  });
});

describe('normalizeEmulatorServices', () => {
  it('aliases provider keys onto canonical registry ids', () => {
    const floci = getEmulatorProvider('floci');
    const normalized = normalizeEmulatorServices('floci', floci.normalizeStatus, {
      monitoring: 'running',
      states: 'running',
      email: 'available',
      events: 'running',
    });

    expect(normalized.services['cloudwatch']).toBe('enabled');
    expect(normalized.services['stepfunctions']).toBe('enabled');
    expect(normalized.services['ses']).toBe('disabled');
    expect(normalized.services['eventbridge']).toBe('enabled');
    // Raw keys stay available for the coverage panel.
    expect(normalized.rawServices['monitoring']).toBe('enabled');
  });

  it('merges several provider keys for one canonical service with enabled winning', () => {
    const floci = getEmulatorProvider('floci');
    const normalized = normalizeEmulatorServices('floci', floci.normalizeStatus, {
      apigateway: 'running',
      apigatewayv2: 'available',
    });
    expect(normalized.services['apigateway']).toBe('enabled');
  });

  it('lets an error state win over enabled', () => {
    const floci = getEmulatorProvider('floci');
    const normalized = normalizeEmulatorServices('floci', floci.normalizeStatus, {
      apigateway: 'running',
      apigatewayv2: 'error',
    });
    expect(normalized.services['apigateway']).toBe('error');
  });
});

describe('summarizeServiceStates', () => {
  it('counts enabled, disabled, errored and everything else', () => {
    expect(
      summarizeServiceStates({
        s3: 'enabled',
        lambda: 'enabled',
        dynamodb: 'error',
        rds: 'disabled',
        ecs: 'starting',
      }),
    ).toEqual({ total: 5, enabled: 2, disabled: 1, error: 1, other: 1 });
  });

  it('handles an empty snapshot', () => {
    expect(summarizeServiceStates({})).toEqual({
      total: 0,
      enabled: 0,
      disabled: 0,
      error: 0,
      other: 0,
    });
  });
});

describe('readReadyState', () => {
  it('reads MiniStack ready.d script progress', () => {
    expect(
      readReadyState({ ready_scripts: { status: 'completed', total: 3, completed: 2, failed: 1 } }),
    ).toEqual({ status: 'completed', total: 3, completed: 2, failed: 1 });
  });

  it('returns null for providers that do not report readiness', () => {
    expect(readReadyState({})).toBeNull();
    expect(readReadyState({ ready_scripts: 'nope' })).toBeNull();
  });
});

describe('isApiErrorResponse', () => {
  it('accepts the shared error shape', () => {
    expect(
      isApiErrorResponse({
        error: { code: 'EMULATOR_UNREACHABLE', message: 'down', statusCode: 503 },
      }),
    ).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isApiErrorResponse({ error: { code: 'X' } })).toBe(false);
    expect(isApiErrorResponse(null)).toBe(false);
    expect(isApiErrorResponse('<html>')).toBe(false);
  });
});
