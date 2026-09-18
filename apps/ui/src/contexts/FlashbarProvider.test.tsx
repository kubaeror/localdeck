// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashbarProvider } from './FlashbarProvider';
import { useFlashbar } from '../hooks/useFlashbar';

function Consumer(): ReactElement {
  const flashbar = useFlashbar();
  return (
    <div>
      <span data-testid="count">{flashbar.items.length}</span>
      <button
        onClick={() => {
          flashbar.notify({ type: 'success', header: 'Bucket created' });
        }}
      >
        notify success
      </button>
      <button
        onClick={() => {
          flashbar.notify({ type: 'error', header: 'Delete failed', content: 'Access denied' });
        }}
      >
        notify error
      </button>
      <button
        onClick={() => {
          flashbar.clear();
        }}
      >
        clear
      </button>
    </div>
  );
}

function renderConsumer(): void {
  render(
    <FlashbarProvider>
      <Consumer />
    </FlashbarProvider>,
  );
}

describe('FlashbarProvider', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('collects notifications as flashbar items', () => {
    renderConsumer();

    fireEvent.click(screen.getByText('notify success'));
    fireEvent.click(screen.getByText('notify error'));

    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('auto-dismisses success messages but keeps errors until dismissed', () => {
    vi.useFakeTimers();
    renderConsumer();

    fireEvent.click(screen.getByText('notify success'));
    fireEvent.click(screen.getByText('notify error'));
    expect(screen.getByTestId('count').textContent).toBe('2');

    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('clears every message', () => {
    renderConsumer();

    fireEvent.click(screen.getByText('notify success'));
    fireEvent.click(screen.getByText('clear'));

    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
