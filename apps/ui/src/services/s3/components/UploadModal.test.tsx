// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadModal } from './UploadModal';

function uploadErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'AccessDenied', message: 'upload denied', statusCode: 403 },
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}

function renderUploadModal(onUploaded = vi.fn(), onDismiss = vi.fn()): ReturnType<typeof render> {
  return render(
    <UploadModal
      visible
      bucket="alpha-bucket"
      prefix=""
      onDismiss={onDismiss}
      onUploaded={onUploaded}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('S3 UploadModal', () => {
  it('pre-checks the 5 GiB single-object limit before uploading', () => {
    renderUploadModal();
    const file = new File(['small'], 'huge.bin');
    Object.defineProperty(file, 'size', { value: 5 * 1024 ** 3 + 1 });
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('file input missing');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/exceeds? the 5 GiB single-object limit/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a full progress bar and a failure per file when an upload fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => uploadErrorResponse()),
    );
    const onUploaded = vi.fn();
    renderUploadModal(onUploaded);
    const file = new File(['data'], 'report.txt');
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('file input missing');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText('Some files were not uploaded')).toBeDefined();
    expect(screen.getByText(/report.txt: LocalStack denied this action/)).toBeDefined();
    expect(screen.getByText('report.txt — Failed')).toBeDefined();
    // Cloudscape renders a native <progress>; its value tops out at 100% once
    // the failed file is counted, instead of stopping at (total-1)/total.
    const progress = document.querySelector('progress');
    if (progress === null) throw new Error('progress bar missing');
    expect(progress.value).toBe(100);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('aborts the upload batch when the modal unmounts', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>(() => {
            signals.push(init?.signal);
          }),
      ),
    );
    const renderResult = renderUploadModal();
    const file = new File(['data'], 'report.txt');
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('file input missing');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });
    expect(signals[0]?.aborted).toBe(false);
    renderResult.unmount();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('cancels an in-progress upload and closes the dialog', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signals.push(init?.signal);
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );
    const onUploaded = vi.fn();
    const onDismiss = vi.fn();
    renderUploadModal(onUploaded, onDismiss);
    const files = [new File(['a'], 'report.txt'), new File(['b'], 'second.txt')];
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('file input missing');
    fireEvent.change(input, { target: { files } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });
    // Cancel stays usable while the batch runs.
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.hasAttribute('disabled')).toBe(false);
    fireEvent.click(cancel);

    expect(signals[0]?.aborted).toBe(true);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Cancelled never reads as failure or success.
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.queryByText('Some files were not uploaded')).toBeNull();
  });
});
