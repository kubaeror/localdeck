// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceDetailPage } from './ResourceDetailPage';
import { StatusBadge } from './StatusBadge';

function renderPage(ui: React.ReactElement): void {
  render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ResourceDetailPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the header, the status badge and the first tab', () => {
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        description="Objects live in buckets."
        breadcrumbs={[{ text: 'S3', href: '/console/s3' }, { text: 'my-bucket' }]}
        status={<StatusBadge status="running" />}
        tabs={[
          { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
          { id: 'tags', label: 'Tags', content: <div>Tags content</div> },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: /my-bucket/ })).toBeDefined();
    expect(screen.getByText('Running')).toBeDefined();
    expect(screen.getByText('Overview content')).toBeDefined();
    expect(screen.getByRole('link', { name: 'S3' })).toBeDefined();
  });

  it('switches tabs', () => {
    const onTabChange = vi.fn();
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        breadcrumbs={[{ text: 'my-bucket' }]}
        tabs={[
          { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
          { id: 'tags', label: 'Tags', content: <div>Tags content</div> },
        ]}
        onTabChange={onTabChange}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Tags' }));

    expect(screen.getByText('Tags content')).toBeDefined();
    expect(onTabChange).toHaveBeenCalledWith('tags');
  });

  it('honours a controlled active tab', () => {
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        breadcrumbs={[{ text: 'my-bucket' }]}
        activeTabId="tags"
        tabs={[
          { id: 'overview', label: 'Overview', content: <div>Overview content</div> },
          { id: 'tags', label: 'Tags', content: <div>Tags content</div> },
        ]}
      />,
    );

    expect(screen.getByText('Tags content')).toBeDefined();
  });

  it('renders a retry alert when loading failed', () => {
    const onRetry = vi.fn();
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        breadcrumbs={[{ text: 'my-bucket' }]}
        error={{ code: 'NOT_FOUND', statusCode: 404, message: 'No such bucket' }}
        onRetry={onRetry}
        tabs={[{ id: 'overview', label: 'Overview', content: <div>Overview content</div> }]}
      />,
    );

    expect(screen.getByText('Could not load this resource')).toBeDefined();
    expect(screen.getByText('No such bucket')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('hides the tabs while loading', () => {
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        breadcrumbs={[{ text: 'my-bucket' }]}
        loading
        tabs={[{ id: 'overview', label: 'Overview', content: <div>Overview content</div> }]}
      />,
    );

    expect(screen.queryByText('Overview content')).toBeNull();
  });

  it('renders notifications above the tabs', () => {
    renderPage(
      <ResourceDetailPage
        title="my-bucket"
        breadcrumbs={[{ text: 'my-bucket' }]}
        notifications={<div>Object versioning is suspended</div>}
        tabs={[{ id: 'overview', label: 'Overview', content: <div>Overview content</div> }]}
      />,
    );

    expect(screen.getByText('Object versioning is suspended')).toBeDefined();
  });
});
