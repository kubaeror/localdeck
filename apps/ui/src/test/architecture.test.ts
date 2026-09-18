import { describe, expect, it } from 'vitest';

/**
 * The browser must never talk to AWS directly: every call goes through the
 * LocalDeck api's dynamic dispatcher, which owns the credentials and enforces
 * the operation whitelist.
 *
 * Source files are read through Vite's glob so the guard needs no filesystem
 * access (and works in the same module graph as the code it checks).
 */
const SOURCES: Readonly<Record<string, string>> = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** This guard quotes the patterns it looks for. */
const SELF = 'test/architecture.test.ts';

describe('ui architecture guards', () => {
  it('never imports the AWS SDK', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith(SELF))
      .filter(
        ([, source]) =>
          /from\s+'@aws-sdk\/[^']+'/.test(source) || /import\('@aws-sdk\//.test(source),
      )
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('keeps every service call routed through the dispatcher client', () => {
    const serviceApiFiles = Object.entries(SOURCES).filter(
      ([path]) => path.startsWith('../services/') && path.endsWith('/api.ts'),
    );

    expect(serviceApiFiles.length).toBeGreaterThan(0);
    for (const [path, source] of serviceApiFiles) {
      expect(source.includes('callServiceOperation'), path).toBe(true);
    }
  });

  it('sends every service request to the api, never to LocalStack', () => {
    // Only lib/apiClient.ts may build fetch calls; everything else uses it.
    // Test files are exempt: a live test stubs fetch to aim it at the running
    // api, and exercises links the console renders (the S3 download proxy)
    // exactly as the browser would.
    const fetchUsers = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('lib/apiClient.ts') && !path.endsWith(SELF))
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, source]) => /\bfetch\(/.test(source))
      .map(([path]) => path);

    expect(fetchUsers).toEqual([]);
  });
});
