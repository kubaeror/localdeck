import type { FastifyReply } from 'fastify';

/** Cap for error bodies read from upstream responses (API-008). */
export const UPSTREAM_ERROR_BODY_MAX_BYTES = 64 * 1024;

/**
 * An AbortSignal that fires only when the client goes away before the response
 * was written.
 *
 * Fastify's own `request.signal` aborts when the raw request stream emits
 * `close`, which for a POST fires as soon as the body has been parsed — not
 * only on a disconnect. Forwarding that signal to the AWS SDK aborted every
 * dispatcher call that carried a body, so the SDK call gets this signal
 * instead: the raw response stream is watched, and a close after the response
 * finished (keep-alive teardown, normal completion) is ignored.
 */
export function clientDisconnectSignal(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  const onClose = (): void => {
    if (!reply.raw.writableFinished && !controller.signal.aborted) controller.abort();
  };
  reply.raw.on('close', onClose);
  return controller.signal;
}

/**
 * Reads at most `maxBytes` of a `fetch` response body and decodes it as UTF-8.
 * Used for upstream error documents: parsing an S3 XML error never needs more
 * than the first few KiB, and an unbounded `response.text()` on a misbehaving
 * endpoint is a memory-exhaustion vector.
 */
export async function readCappedText(
  response: Pick<Response, 'body'>,
  maxBytes: number = UPSTREAM_ERROR_BODY_MAX_BYTES,
): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const remaining = maxBytes - received;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        received = maxBytes;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
