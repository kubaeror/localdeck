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

  it('does not turn an intermediate crumb without href into a self-link', () => {
    renderTrail([{ text: 'S3', href: '/console/s3' }, { text: 'Buckets' }, { text: 'my-bucket' }]);

    const bucketsLinks = screen.getAllByRole('link', { name: 'Buckets' });
    expect(bucketsLinks.length).toBeGreaterThan(0);
    for (const link of bucketsLinks) {
      expect(link.getAttribute('href')).not.toBe('/console/s3/buckets/my-bucket');
    }
  });

  it('always links back to Console Home', () => {
    renderTrail([{ text: 'my-bucket' }]);

    const home = screen.getByRole('link', { name: 'Console Home' });
    expect(home.getAttribute('href')).toBe('/console/home');
  });
});
