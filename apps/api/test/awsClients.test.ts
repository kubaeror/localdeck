import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildAwsClientConfig,
  createAwsClientInstance,
  destroyAwsClients,
  getOrCreateAwsClient,
  sdkAbortSignal,
  type AwsSdkClient,
} from '../src/lib/awsClients.js';

/**
 * Guard for the "one client factory" rule: no module may construct an AWS SDK
 * client (or import a `*Client` class) outside `src/lib/awsClients.ts`.
 *
 * The dynamic dispatcher never imports a client class at all — it loads the
 * registry's `sdkPackage` at runtime and hands the constructor to the factory.
 */

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT_FACTORY = join('src', 'lib', 'awsClients.ts');

/** Imported names ending in `Client`, ignoring type-only imports. */
export function findSdkClientImports(source: string): readonly string[] {
  const found: string[] = [];

  const namedImports = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+'@aws-sdk\/client-[^']*'/g;
  for (const match of source.matchAll(namedImports)) {
    if (match[1] !== undefined) continue;
    for (const rawEntry of (match[2] ?? '').split(',')) {
      const entry = rawEntry.trim();
      // Inline type imports (`import { type S3Client }`) never construct anything.
      if (entry.length === 0 || /^type\s/.test(entry)) continue;
      const localName = (entry.split(/\s+as\s+/).pop() ?? entry).trim();
      if (localName.endsWith('Client')) found.push(localName);
    }
  }

  const defaultImports = /import\s+([A-Za-z0-9_$]+)\s+from\s+'@aws-sdk\/client-[^']*'/g;
  for (const match of source.matchAll(defaultImports)) {
    const name = match[1] ?? '';
    if (name.endsWith('Client')) found.push(name);
  }

  return found;
}

function listTypeScriptFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listTypeScriptFiles(path));
      continue;
    }
    if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

describe('findSdkClientImports', () => {
  it('flags named, aliased and default client imports', () => {
    expect(
      findSdkClientImports(
        "import { S3Client } from '@aws-sdk/client-s3';\n" +
          "import { STSClient as Client } from '@aws-sdk/client-sts';\n" +
          "import DynamoDBClient from '@aws-sdk/client-dynamodb';",
      ),
    ).toEqual(['S3Client', 'Client', 'DynamoDBClient']);
  });

  it('ignores type-only imports and command imports', () => {
    expect(
      findSdkClientImports(
        "import type { S3Client } from '@aws-sdk/client-s3';\n" +
          "import { type STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';",
      ),
    ).toEqual([]);
  });
});

describe('aws client factory', () => {
  it('is the only file that imports or constructs SDK clients', () => {
    const offenders: string[] = [];

    for (const directory of ['src', 'scripts', 'test']) {
      for (const file of listTypeScriptFiles(join(API_ROOT, directory))) {
        const relativePath = relative(API_ROOT, file);
        if (relativePath === CLIENT_FACTORY) continue;
        // The guard test itself mentions the patterns it looks for.
        if (relativePath.endsWith('awsClients.test.ts')) continue;

        const source = readFileSync(file, 'utf8');
        const imported = findSdkClientImports(source);
        if (imported.length > 0) offenders.push(`${relativePath}: imports ${imported.join(', ')}`);

        if (/new\s+[A-Za-z0-9_$]*Client\s*\(/.test(source)) {
          offenders.push(`${relativePath}: constructs a client with new …Client(…)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('builds NodeHttpHandler options with throwOnRequestTimeout (API-002)', () => {
    const config = buildAwsClientConfig({ connectionTimeoutMs: 2345, requestTimeoutMs: 1234 });
    expect(config.requestHandler).toEqual({
      connectionTimeout: 2345,
      requestTimeout: 1234,
      throwOnRequestTimeout: true,
    });

    // The default connection also has the guard enabled; the behavioral proof
    // lives in timeouts.test.ts (a hung LocalStack answers 504, not a hang).
    expect(buildAwsClientConfig().requestHandler.throwOnRequestTimeout).toBe(true);
  });

  it('tracks every instance and clears the memo cache on destroy', () => {
    let destroyed = 0;
    class FakeClient implements AwsSdkClient {
      static instances = 0;

      constructor(_config: unknown) {
        FakeClient.instances += 1;
      }

      async send(): Promise<unknown> {
        return {};
      }

      destroy(): void {
        destroyed += 1;
      }
    }

    const memoized = getOrCreateAwsClient('lifecycle-key', () =>
      createAwsClientInstance(FakeClient),
    );
    expect(
      getOrCreateAwsClient('lifecycle-key', () => {
        throw new Error('the memoized client must be reused');
      }),
    ).toBe(memoized);

    destroyAwsClients();
    expect(destroyed).toBeGreaterThanOrEqual(1);
    // After destroy the same key builds a fresh, tracked instance.
    const rebuilt = getOrCreateAwsClient('lifecycle-key', () =>
      createAwsClientInstance(FakeClient),
    );
    expect(rebuilt).not.toBe(memoized);
    destroyAwsClients();
    expect(destroyed).toBeGreaterThanOrEqual(2);
  });

  it('combines caller aborts with the request timeout signal', () => {
    const controller = new AbortController();
    const combined = sdkAbortSignal(controller.signal, 60_000);
    expect(combined.aborted).toBe(false);

    controller.abort();
    expect(combined.aborted).toBe(true);

    const timedOut = sdkAbortSignal(undefined, 10);
    expect(timedOut.aborted).toBe(false);
  });
});
