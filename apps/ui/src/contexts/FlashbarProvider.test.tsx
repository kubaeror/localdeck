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
      <span data-testid="headers">
        {flashbar.items.map((item) => String(item.header)).join('|')}
      </span>
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
          for (let index = 1; index <= 7; index += 1) {
            flashbar.notify({ type: 'error', header: `Error ${index}` });
          }
        }}
      >
        notify many
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
    // The error survived; the success is the one that was dismissed.
    expect(screen.getByTestId('headers').textContent).toContain('Delete failed');
    expect(screen.getByTestId('headers').textContent).not.toContain('Bucket created');
  });

  it('coalesces identical type+header notifications', () => {
    renderConsumer();

    fireEvent.click(screen.getByText('notify success'));
    fireEvent.click(screen.getByText('notify success'));

    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('headers').textContent).toBe('Bucket created');
  });

  it('caps the flashbar at the newest five messages', () => {
    renderConsumer();

    fireEvent.click(screen.getByText('notify many'));

    expect(screen.getByTestId('count').textContent).toBe('5');
    const headers = screen.getByTestId('headers').textContent ?? '';
    expect(headers).toContain('Error 7');
    expect(headers).not.toContain('Error 1');
  });

  it('clears every message', () => {
    renderConsumer();

    fireEvent.click(screen.getByText('notify success'));
    fireEvent.click(screen.getByText('clear'));

    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
