// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ArnLink } from './ArnLink';

describe('ArnLink', () => {
  afterEach(() => {
    cleanup();
  });

  function renderLink(arn: string, label?: string): void {
    render(
      <MemoryRouter>
        <ArnLink arn={arn} {...(label === undefined ? {} : { label })} />
      </MemoryRouter>,
    );
  }

  it('links an ARN to the service console it belongs to', () => {
    renderLink('arn:aws:sqs:us-east-1:000000000000:my-queue');

    const link = screen.getByRole('link', { name: /Open the SQS console for my-queue/ });
    expect(link.getAttribute('href')).toBe('/console/sqs');
    expect(link.textContent).toBe('my-queue');
  });

  it('maps ARN namespaces onto LocalDeck services', () => {
    renderLink('arn:aws:states:us-east-1:000000000000:stateMachine:flow');
    expect(screen.getByRole('link', { name: /Step Functions console/ })).toBeDefined();
  });

  it('accepts an explicit label', () => {
    renderLink('arn:aws:s3:::my-bucket', 'the bucket');
    expect(screen.getByRole('link', { name: /Open the S3 console for the bucket/ })).toBeDefined();
  });

  it('renders plain code when there is no console for the ARN service', () => {
    renderLink('arn:aws:unknown-service:::thing');

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('arn:aws:unknown-service:::thing')).toBeDefined();
  });

  it('renders plain code for values that are not ARNs', () => {
    renderLink('just-a-string');

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('just-a-string')).toBeDefined();
  });
});

describe('ArnLink tooltips', () => {
  it('explains why an ARN is not a link', () => {
    render(
      <MemoryRouter>
        <ArnLink arn="arn:aws:unknown-service:::thing" />
      </MemoryRouter>,
    );

    const tooltip = screen.getByLabelText('LocalDeck has no unknown-service console yet.');
    expect(tooltip).toBeDefined();
    cleanup();
  });
});
