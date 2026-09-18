import { describe, expect, it } from 'vitest';
import { readCappedText, UPSTREAM_ERROR_BODY_MAX_BYTES } from '../src/lib/http.js';

/** Builds a fake Response-like object from a byte stream. */
function responseFrom(body: ReadableStream<Uint8Array> | null): Pick<Response, 'body'> {
  return { body };
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe('readCappedText (API-008)', () => {
  it('decodes small bodies unchanged', async () => {
    const response = responseFrom(streamOf([new TextEncoder().encode('<Error>small</Error>')]));
    await expect(readCappedText(response)).resolves.toBe('<Error>small</Error>');
  });

  it('returns an empty string for a missing body', async () => {
    await expect(readCappedText(responseFrom(null))).resolves.toBe('');
  });

  it('stops reading after the cap', async () => {
    const cap = 16;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 10) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(cap).fill(0x61));
      },
    });

    const text = await readCappedText(responseFrom(body), cap);
    expect(new TextEncoder().encode(text)).toHaveLength(cap);
    // Cancelled after the first over-cap pull instead of draining 10 chunks.
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it('never reads more than the default 64 KiB cap from a huge error body', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(0x62);
    const chunks = Array.from({ length: 64 }, () => chunk);
    const text = await readCappedText(responseFrom(streamOf(chunks)));
    expect(new TextEncoder().encode(text)).toHaveLength(UPSTREAM_ERROR_BODY_MAX_BYTES);
  });
});
