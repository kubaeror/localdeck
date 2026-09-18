// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENTLY_VISITED_STORAGE_KEY } from './recently-visited-context';
import { RecentlyVisitedProvider } from './RecentlyVisitedProvider';
import { useRecentlyVisited } from '../hooks/useRecentlyVisited';

function Consumer(): ReactElement {
  const { visited, record, clear } = useRecentlyVisited();
  return (
    <div>
      <span data-testid="trail">{visited.map((entry) => entry.id).join(',')}</span>
      <button
        onClick={() => {
          record('s3');
        }}
      >
        visit s3
      </button>
      <button
        onClick={() => {
          record('lambda');
        }}
      >
        visit lambda
      </button>
      {['dynamodb', 'sqs', 'sns', 'iam', 'ec2', 'kms', 'logs', 'athena'].map((id) => (
        <button
          key={id}
          onClick={() => {
            record(id);
          }}
        >
          visit {id}
        </button>
      ))}
      <button
        onClick={() => {
          clear();
        }}
      >
        clear
      </button>
    </div>
  );
}

describe('RecentlyVisitedProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('records the most recent visit first and persists it', () => {
    render(
      <RecentlyVisitedProvider>
        <Consumer />
      </RecentlyVisitedProvider>,
    );

    fireEvent.click(screen.getByText('visit s3'));
    fireEvent.click(screen.getByText('visit lambda'));

    expect(screen.getByTestId('trail').textContent).toBe('lambda,s3');
    expect(window.localStorage.getItem(RECENTLY_VISITED_STORAGE_KEY)).toContain('lambda');
  });

  it('moves a repeated visit to the front instead of duplicating it', () => {
    render(
      <RecentlyVisitedProvider>
        <Consumer />
      </RecentlyVisitedProvider>,
    );

    fireEvent.click(screen.getByText('visit s3'));
    fireEvent.click(screen.getByText('visit lambda'));
    fireEvent.click(screen.getByText('visit s3'));

    expect(screen.getByTestId('trail').textContent).toBe('s3,lambda');
  });

  it('caps the trail so the widget stays readable', () => {
    render(
      <RecentlyVisitedProvider>
        <Consumer />
      </RecentlyVisitedProvider>,
    );

    for (const id of ['dynamodb', 'sqs', 'sns', 'iam', 'ec2', 'kms', 'logs', 'athena']) {
      fireEvent.click(screen.getByText(`visit ${id}`));
    }

    expect(screen.getByTestId('trail').textContent?.split(',')).toHaveLength(6);
  });

  it('ignores malformed storage', () => {
    window.localStorage.setItem(RECENTLY_VISITED_STORAGE_KEY, '{"not":"an array"}');

    render(
      <RecentlyVisitedProvider>
        <Consumer />
      </RecentlyVisitedProvider>,
    );

    expect(screen.getByTestId('trail').textContent).toBe('');
  });

  it('clears the trail', () => {
    render(
      <RecentlyVisitedProvider>
        <Consumer />
      </RecentlyVisitedProvider>,
    );

    fireEvent.click(screen.getByText('visit s3'));
    fireEvent.click(screen.getByText('clear'));

    expect(screen.getByTestId('trail').textContent).toBe('');
  });
});
