import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PlopTypes } from '@turbo/gen';

/**
 * LocalDeck generators.
 *
 *   pnpm turbo gen service
 *
 * `service` scaffolds `apps/ui/src/services/<id>/` (index.ts, spec.ts, api.ts
 * and the List/Detail/Create pages) and appends the matching entry to the
 * shared registry, which is what makes the service show up in the api
 * dispatcher as well. The ui discovers the module through
 * the import.meta.glob lookup over service folders, so no other wiring is needed.
 */

const CATEGORIES = [
  'Compute',
  'Containers',
  'Storage',
  'Database',
  'Networking & CDN',
  'Security Identity & Compliance',
  'Application Integration',
  'Analytics',
  'Management & Governance',
  'Developer Tools',
  'Machine Learning',
] as const;

const PARITY_LEVELS = ['browser', 'dedicated', 'planned'] as const;

/**
 * `turbo gen` runs from the repository root; plop resolves action paths relative
 * to the generator folder, so every target is made absolute on purpose.
 */
const REPO_ROOT = process.cwd();
const CATALOG_DIRECTORY = path.join(REPO_ROOT, 'packages/shared/src/catalog');
const SERVICE_MODULE_DIRECTORY = path.join(REPO_ROOT, 'apps/ui/src/services');
const TEMPLATE_DIRECTORY = 'templates/service';

/** Catalog file per console category; the generated entry is appended there. */
const CATEGORY_FILES: Readonly<Record<(typeof CATEGORIES)[number], string>> = {
  Compute: 'compute.ts',
  Containers: 'containers.ts',
  Storage: 'storage.ts',
  Database: 'database.ts',
  'Networking & CDN': 'networking.ts',
  'Security Identity & Compliance': 'security.ts',
  'Application Integration': 'integration.ts',
  Analytics: 'analytics.ts',
  'Management & Governance': 'management.ts',
  'Developer Tools': 'developer-tools.ts',
  'Machine Learning': 'machine-learning.ts',
};

/**
 * Category glyphs that already have a Lucide mapping in
 * `apps/ui/src/components/service-icons/iconMap.ts`, so a generated service
 * renders without touching the icon map first.
 */
const CATEGORY_ICON_KEYS: Readonly<Record<(typeof CATEGORIES)[number], string>> = {
  Compute: 'ec2',
  Containers: 'ecs',
  Storage: 's3',
  Database: 'dynamodb',
  'Networking & CDN': 'cloudfront',
  'Security Identity & Compliance': 'iam',
  'Application Integration': 'sqs',
  Analytics: 'cloudwatch',
  'Management & Governance': 'cloudformation',
  'Developer Tools': 'codebuild',
  'Machine Learning': 'sagemaker',
};

/**
 * Anchor: the closing line of a category catalogue array. The generated entry
 * is inserted right before it, which keeps the file's imports and helpers
 * untouched.
 */
const REGISTRY_ANCHOR = /\n\] as const satisfies readonly ServiceDescriptor\[\];\n/;
const REGISTRY_ANCHOR_TEXT = '\n] as const satisfies readonly ServiceDescriptor[];\n';

const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const OPERATION_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/** Accepts comma or pipe separated operation lists. */
function parseOperations(value: string): string[] {
  return value
    .split(/[,|]/)
    .map((operation) => operation.trim())
    .filter((operation) => operation.length > 0);
}

function defaultSdkPackage(name: string): string {
  return `@aws-sdk/client-${name}`;
}

function pascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => (part.length === 0 ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join('');
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setWelcomeMessage(
    'LocalDeck generators — run `pnpm turbo gen service` to add a service module.',
  );

  /** Formats the files a generator just wrote, so the repo stays lint-clean. */
  plop.setActionType('prettier', (answers, config) => {
    const targets = Array.isArray(config['paths']) ? (config['paths'] as string[]) : [];
    const rendered = targets.map((target) => plop.renderString(target, answers));
    try {
      execFileSync(
        'pnpm',
        ['exec', 'prettier', '--write', '--no-error-on-unmatched-pattern', ...rendered],
        { stdio: 'ignore' },
      );
      return `formatted ${rendered.length} path(s)`;
    } catch (error) {
      // Formatting is a convenience: never fail a generator run over it.
      return `prettier skipped (${error instanceof Error ? error.message : String(error)})`;
    }
  });

  plop.setGenerator('service', {
    description: 'Add a service module (pages, spec, api) and register it in the registry',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Service id (lowercase, matches the LocalStack key, e.g. s3, dynamodb):',
        validate: (value: unknown) =>
          typeof value === 'string' && NAME_PATTERN.test(value)
            ? true
            : 'Use lowercase letters, digits and dashes, starting with a letter.',
      },
      {
        type: 'input',
        name: 'displayName',
        message: 'Display name shown in the console:',
        default: (answers: PlopTypes.Answers) => pascalCase(String(answers['name'] ?? '')),
      },
      {
        type: 'list',
        name: 'category',
        message: 'Console category:',
        choices: [...CATEGORIES],
      },
      {
        type: 'input',
        name: 'sdkPackage',
        message: 'AWS SDK v3 package the api proxies this service with:',
        default: (answers: PlopTypes.Answers) => defaultSdkPackage(String(answers['name'] ?? '')),
      },
      {
        type: 'input',
        name: 'operations',
        message: 'Whitelisted operations (comma separated, PascalCase, e.g. ListBuckets):',
        validate: (value: unknown) => {
          if (typeof value !== 'string') return 'Enter at least one operation.';
          const operations = parseOperations(value);
          if (operations.length === 0) return 'Enter at least one operation.';
          const invalid = operations.filter((operation) => !OPERATION_PATTERN.test(operation));
          return invalid.length === 0 ? true : `Not an AWS operation name: ${invalid.join(', ')}`;
        },
      },
      {
        type: 'input',
        name: 'listOperation',
        message: 'Operation the generated list page calls:',
        default: (answers: PlopTypes.Answers) =>
          parseOperations(String(answers['operations'] ?? ''))[0] ?? 'ListResources',
      },
      {
        type: 'input',
        name: 'createOperation',
        message: 'Create operation for the wizard (leave empty to skip the create flow):',
        default: '',
        validate: (value: unknown) =>
          typeof value !== 'string' ||
          value.trim().length === 0 ||
          OPERATION_PATTERN.test(value.trim())
            ? true
            : 'Use a PascalCase AWS operation name, or leave empty.',
      },
      {
        type: 'input',
        name: 'createNameField',
        message: 'Input field the created resource name maps to:',
        default: 'Name',
      },
      {
        type: 'list',
        name: 'parityLevel',
        message: 'LocalDeck parity level:',
        choices: [...PARITY_LEVELS],
        default: 'browser',
      },
      {
        type: 'input',
        name: 'summary',
        message: 'One-line description for search and empty states:',
        default: (answers: PlopTypes.Answers) =>
          `Manage ${String(answers['displayName'] ?? '')} resources in LocalStack.`,
      },
    ],
    actions: (answers) => {
      const serviceId = String(answers?.['name'] ?? '');
      const category = String(answers?.['category'] ?? 'Compute') as (typeof CATEGORIES)[number];
      const registryPath = path.join(CATALOG_DIRECTORY, CATEGORY_FILES[category]);
      const modulePath = path.join(SERVICE_MODULE_DIRECTORY, serviceId);
      const moduleRelative = path.relative(REPO_ROOT, modulePath);
      const operations = parseOperations(String(answers?.['operations'] ?? ''));
      const createOperation = String(answers?.['createOperation'] ?? '').trim();
      const parityLevel = String(answers?.['parityLevel'] ?? 'browser');
      const listOperation =
        String(answers?.['listOperation'] ?? '').trim() || operations[0] || 'ListResources';

      // Templates iterate the answers, so hand them the parsed list. (Turbo's
      // `--args` passthrough skips prompt filters, so normalise here.)
      if (answers !== undefined && answers !== null) {
        answers['operations'] = operations;
      }
      // The registry is one file per category; scan all of them for the id.
      const registrySource = Object.values(CATEGORY_FILES)
        .map((file) => readFileSync(path.join(CATALOG_DIRECTORY, file), 'utf8'))
        .join('\n');
      const alreadyRegistered = new RegExp(`\\bid: '${serviceId}',`).test(registrySource);

      const browserBinding =
        parityLevel === 'browser'
          ? `    browser: {\n      list: { operation: '${listOperation}' },\n    },\n`
          : '';

      const registryAction: PlopTypes.ActionType | null = alreadyRegistered
        ? null
        : {
            // The api resolves the sdk package and the whitelist from the
            // registry, so a new service only becomes dispatchable once its
            // entry exists.
            type: 'modify',
            path: registryPath,
            pattern: REGISTRY_ANCHOR,
            template:
              '\n  // Added by `pnpm turbo gen service`.\n' +
              '  {\n' +
              "    id: '{{name}}',\n" +
              "    displayName: '{{displayName}}',\n" +
              "    category: '{{category}}',\n" +
              "    sdkPackage: '{{sdkPackage}}',\n" +
              `    iconKey: '${CATEGORY_ICON_KEYS[category]}',\n` +
              '    operations: [\n' +
              '{{#each operations}}      ' +
              "'{{this}}',\n" +
              '{{/each}}    ],\n' +
              "    parityLevel: '{{parityLevel}}',\n" +
              "    summary: '{{summary}}',\n" +
              browserBinding +
              '  },\n' +
              REGISTRY_ANCHOR_TEXT,
          };

      return [
        {
          type: 'addMany',
          destination: modulePath,
          base: TEMPLATE_DIRECTORY,
          templateFiles: `${TEMPLATE_DIRECTORY}/**/*.hbs`,
          stripExtensions: ['hbs'],
          // Re-running the generator refreshes the scaffold instead of failing.
          force: true,
          globOptions: {},
          verbose: true,
        },
        ...(registryAction === null ? [] : [registryAction]),
        {
          type: 'prettier',
          paths: [
            path.join(modulePath, '**/*.ts'),
            path.join(modulePath, '**/*.tsx'),
            registryPath,
          ],
        } as unknown as PlopTypes.ActionType,
        () => {
          const lines = [
            `Service module created: ${moduleRelative}`,
            alreadyRegistered
              ? `Registry entry kept: "${serviceId}" is already registered in packages/shared/src/catalog/.`
              : `Registry entry added to packages/shared/src/catalog/${CATEGORY_FILES[category]}.`,
            'Next steps:',
            `  1. Add the SDK package to the api:  pnpm --filter @localdeck/api add ${String(answers?.['sdkPackage'] ?? '')}`,
            `  2. Start the console:               pnpm dev`,
            `  3. Open http://localhost:5173/console/${serviceId}`,
          ];
          if (operations.length > 0 && createOperation.length === 0) {
            lines.push(
              '  · The create wizard scaffold is included but disabled: add a create operation to spec.ts when you are ready.',
            );
          }
          return lines.join('\n');
        },
      ];
    },
  });
}
