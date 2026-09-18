// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateFolderModal } from './CreateFolderModal';
import { ObjectMetadataModal } from './ObjectMetadataModal';

function stubHeadObject(result: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ service: 's3', operation: 'HeadObject', result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('S3 dialogs', () => {
  it('describes the root folder location without a double slash', () => {
    const { rerender } = render(
      <CreateFolderModal
        visible
        bucket="alpha-bucket"
        prefix=""
        onDismiss={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('Created at s3://alpha-bucket')).toBeDefined();

    rerender(
      <CreateFolderModal
        visible
        bucket="alpha-bucket"
        prefix="docs/"
        onDismiss={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('Created at s3://alpha-bucket/docs/')).toBeDefined();
  });

  it('renders the content disposition of the object metadata', async () => {
    stubHeadObject({
      ContentLength: 128,
      ContentType: 'text/plain',
      ContentDisposition: 'attachment; filename="report.txt"',
      Metadata: {},
    });

    render(
      <ObjectMetadataModal
        bucket="alpha-bucket"
        entry={{ kind: 'object', key: 'docs/report.txt', name: 'report.txt' }}
        onDismiss={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    expect(await screen.findByText('Content disposition')).toBeDefined();
    expect(screen.getByText('attachment; filename="report.txt"')).toBeDefined();
  });
});
