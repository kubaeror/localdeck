#!/usr/bin/env tsx
/**
 * Repository invariants a fresh clone must satisfy: the legal disclaimer is
 * present in the README and the app footer, the license is MIT, no image can
 * be mistaken for a screenshot of another cloud console, and no obvious secret
 * material is committed. Run with `pnpm verify:repo` (CI runs it too).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DISCLAIMER =
  'Amazon Web Services, AWS and the Powered by AWS logo are trademarks of Amazon.com, Inc. or its affiliates. LocalDeck is not affiliated with or endorsed by Amazon Web Services.';

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
  'test-results',
  'playwright-report',
]);

/** Screenshots of LocalDeck's own ui, vendored icon artwork and favicons only. */
const ALLOWED_RASTER_DIRECTORIES = ['docs/screens'];
/** Icon artwork is SVG only: a raster dropped here could be a foreign-console shot. */
const SVG_ONLY_DIRECTORIES = ['apps/ui/src/assets'];
const IMAGE_EXTENSIONS = new Set(['.png', '.gif', '.jpg', '.jpeg', '.webp', '.avif']);

const SECRET_PATTERNS: readonly { name: string; pattern: RegExp; allow?: RegExp }[] = [
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  { name: 'GitHub token', pattern: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
];

interface Failure {
  check: string;
  message: string;
}

const failures: Failure[] = [];

function fail(check: string, message: string): void {
  failures.push({ check, message });
}

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function checkDisclaimer(): void {
  const readme = normalizeWhitespace(read('README.md'));
  if (!readme.includes(normalizeWhitespace(DISCLAIMER))) {
    fail('disclaimer', 'README.md does not contain the required legal disclaimer verbatim.');
  }
  const footer = normalizeWhitespace(read('apps/ui/src/layout/AppFooter.tsx'));
  if (!footer.includes(normalizeWhitespace(DISCLAIMER))) {
    fail(
      'disclaimer',
      'AppFooter.tsx does not render the full required legal disclaimer verbatim.',
    );
  }
}

function checkLicense(): void {
  const license = read('LICENSE');
  if (!license.startsWith('MIT License')) {
    fail('license', 'LICENSE is not the MIT License.');
  }
  const packageJson = JSON.parse(read('package.json')) as { license?: string };
  if (packageJson.license !== 'MIT') {
    fail(
      'license',
      `package.json declares "${packageJson.license ?? 'no license'}" instead of MIT.`,
    );
  }
}

function walk(directory: string, relative: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...walk(path.join(directory, entry.name), `${relative}/${entry.name}`));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push(`${relative}/${entry.name}`);
  }
  return files;
}

function checkTree(): void {
  const files = walk(REPO_ROOT, '');
  for (const relativePath of files) {
    const extension = path.extname(relativePath).toLowerCase();
    const withoutLeadingSlash = relativePath.replace(/^\//, '');
    const basename = path.basename(relativePath);

    // `.env` and any `.env.*` variant are committed environment files; the
    // documented template `.env.example` is the one allowed exception.
    if ((basename === '.env' || basename.startsWith('.env.')) && basename !== '.env.example') {
      fail('secrets', `${relativePath} looks like a committed environment file.`);
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      const allowed = ALLOWED_RASTER_DIRECTORIES.some((directory) =>
        withoutLeadingSlash.startsWith(`${directory}/`),
      );
      if (!allowed) {
        fail(
          'images',
          `${relativePath} is a raster image; only LocalDeck's own ui screenshots under ` +
            `${ALLOWED_RASTER_DIRECTORIES.join(', ')} and SVG artwork under ` +
            `${SVG_ONLY_DIRECTORIES.join(', ')} are allowed.`,
        );
      }
    }

    // Only text-ish files are scanned for secret material.
    if (
      !/\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|md|txt|env|example|template|sh|conf|properties)$/.test(
        relativePath,
      ) &&
      extension !== ''
    ) {
      continue;
    }
    let content: string;
    try {
      if (statSync(path.join(REPO_ROOT, relativePath)).size > 2_000_000) continue;
      content = read(withoutLeadingSlash);
    } catch {
      continue;
    }
    for (const { name, pattern, allow } of SECRET_PATTERNS) {
      if (allow?.test(content)) continue;
      if (pattern.test(content)) {
        fail('secrets', `${relativePath} matches the ${name} pattern.`);
      }
    }
  }
}

checkDisclaimer();
checkLicense();
checkTree();

if (failures.length > 0) {
  console.error('Repository invariants failed:\n');
  for (const { check, message } of failures) {
    console.error(`  [${check}] ${message}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    'Repository invariants OK (disclaimer, MIT license, no secret material, own-ui images only).',
  );
}
