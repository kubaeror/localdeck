import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
