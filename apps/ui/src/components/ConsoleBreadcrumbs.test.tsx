import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ConsoleBreadcrumbs, type ConsoleBreadcrumb } from './ConsoleBreadcrumbs';

function renderTrail(items: readonly ConsoleBreadcrumb[]): void {
  render(
    <MemoryRouter initialEntries={['/console/s3/buckets/my-bucket']}>
      <ConsoleBreadcrumbs items={items} />
    </MemoryRouter>,
  );
}

describe('ConsoleBreadcrumbs', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the current crumb as text with aria-current, not a self-link', () => {
    renderTrail([{ text: 'S3', href: '/console/s3' }, { text: 'my-bucket' }]);

    const current = screen.getByRole('link', { name: 'my-bucket' });
    expect(current.tagName).toBe('SPAN');
    expect(current.getAttribute('aria-current')).toBe('page');

    const s3 = screen.getByRole('link', { name: 'S3' });
    expect(s3.tagName).toBe('A');
    expect(s3.getAttribute('href')).toBe('/console/s3');
  });

  it('omits an intermediate crumb without href instead of rendering a dead "#" link', () => {
    renderTrail([{ text: 'S3', href: '/console/s3' }, { text: 'Buckets' }, { text: 'my-bucket' }]);

    // Cloudscape's BreadcrumbGroup renders every item except the last as an
    // anchor (`href || '#'`), so an href-less intermediate step cannot be a
    // plain text item: it is dropped from the trail instead.
    expect(screen.queryByRole('link', { name: 'Buckets' })).toBeNull();
    expect(document.querySelector('a[href="#"]')).toBeNull();

    // Linked steps keep their target; the current page is still text.
    expect(screen.getByRole('link', { name: 'S3' }).getAttribute('href')).toBe('/console/s3');
    const current = screen.getByRole('link', { name: 'my-bucket' });
    expect(current.tagName).toBe('SPAN');
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('keeps an intermediate crumb that has an href as a real link', () => {
    renderTrail([
      { text: 'S3', href: '/console/s3' },
      { text: 'Buckets', href: '/console/s3/buckets' },
      { text: 'my-bucket' },
    ]);

    const buckets = document.querySelector('a[href="/console/s3/buckets"]');
    expect(buckets?.textContent).toBe('Buckets');
  });

  it('always links back to Console Home', () => {
    renderTrail([{ text: 'my-bucket' }]);

    const home = screen.getByRole('link', { name: 'Console Home' });
    expect(home.getAttribute('href')).toBe('/console/home');
  });
});
