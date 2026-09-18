// @vitest-environment jsdom
import { SERVICE_CATALOG } from '@localdeck/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ServiceIcon } from './ServiceIcon';

describe('ServiceIcon', () => {
  afterEach(() => {
    cleanup();
  });

  it('falls back to a Lucide glyph while the AWS icon pack is not vendored', () => {
    const { container } = render(<ServiceIcon iconKey="s3" category="Storage" />);

    const icon = container.querySelector('[data-service-icon]');
    expect(icon?.getAttribute('data-service-icon')).toBe('lucide');
    expect(icon?.getAttribute('data-icon-key')).toBe('s3');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // The glyph is a real svg, not an empty placeholder.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders an accessible name when a label is given', () => {
    render(<ServiceIcon iconKey="lambda" category="Compute" label="Lambda" />);

    expect(screen.getByRole('img', { name: 'Lambda' })).toBeDefined();
  });

  it('renders unknown icon keys with the category fallback', () => {
    const { container } = render(
      <ServiceIcon iconKey="not-a-service" category="Machine Learning" />,
    );

    expect(container.querySelector('[data-service-icon="lucide"]')).not.toBeNull();
  });

  it('renders every registry service icon', () => {
    for (const service of SERVICE_CATALOG) {
      cleanup();
      const { container } = render(
        <ServiceIcon iconKey={service.iconKey} category={service.category} />,
      );
      expect(container.querySelector('[data-service-icon]'), service.id).not.toBeNull();
    }
  });
});
