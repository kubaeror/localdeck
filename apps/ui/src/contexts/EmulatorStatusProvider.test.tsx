import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorStatusProvider } from './EmulatorStatusProvider';
import { useEmulatorStatus } from '../hooks/useEmulatorStatus';
import { jsonResponse, TEST_CONFIG, TEST_HEALTH, TEST_REGISTRY } from '../test/fixtures';

function Consumer(): ReactElement {
  const status = useEmulatorStatus();
  return (
    <div>
      <span data-testid="phase">{status.phase}</span>
      <span data-testid="endpoint">{status.config?.emulator.endpoint ?? ''}</span>
      <span data-testid="version">{status.health?.emulator.version ?? ''}</span>
      <button
        onClick={() => {
          status.refresh();
        }}
      >
        refresh
      </button>
    </div>
  );
}

function renderProvider(): void {
  render(
    <EmulatorStatusProvider>
      <Consumer />
    </EmulatorStatusProvider>,
  );
}

describe('EmulatorStatusProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads config and health and reports connected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config')) return jsonResponse(TEST_CONFIG);
      if (url.includes('/api/health')) return jsonResponse(TEST_HEALTH);
      if (url.includes('/api/services')) return jsonResponse(TEST_REGISTRY);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();

    expect(await screen.findByText('connected')).toBeDefined();
    expect(screen.getByTestId('endpoint').textContent).toBe('http://localhost:4566');
    expect(screen.getByTestId('version').textContent).toBe('2026.8.2');
  });

  it('reports an unreachable LocalStack and keeps the last known config', async () => {
    let unreachable = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config')) return jsonResponse(TEST_CONFIG);
      if (url.includes('/api/health')) {
        if (!unreachable) return jsonResponse(TEST_HEALTH);
        return jsonResponse(
          {
            error: {
              code: 'LOCALSTACK_UNREACHABLE',
              statusCode: 503,
              message: 'LocalStack is unreachable at http://localhost:4566.',
            },
          },
          503,
        );
      }
      if (url.includes('/api/services')) return jsonResponse(TEST_REGISTRY);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();
    expect(await screen.findByText('connected')).toBeDefined();

    unreachable = true;
    fireEvent.click(screen.getByText('refresh'));

    expect(await screen.findByText('unreachable')).toBeDefined();
    // The last known endpoint stays visible so the user can act on it.
    expect(screen.getByTestId('endpoint').textContent).toBe('http://localhost:4566');
  });

  it('clamps a malformed poll interval to the 1s minimum', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/config')) {
        return jsonResponse({ ...TEST_CONFIG, ui: { statusPollIntervalMs: 5 } });
      }
      if (url.includes('/api/health')) return jsonResponse(TEST_HEALTH);
      if (url.includes('/api/services')) return jsonResponse(TEST_REGISTRY);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderProvider();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const healthCalls = (): number =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/health')).length;
    expect(healthCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(healthCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(healthCalls()).toBe(2);
  });
});
