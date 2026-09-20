import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          // A suppression must say why it is safe, so the reason is reviewable.
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
    },
  },
  {
    // Node-side workspaces and repository tooling. Browser globals are NOT
    // available here, and Node globals are not available in apps/ui.
    files: [
      'apps/api/**/*.{ts,tsx}',
      'apps/console/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'e2e/**/*.{ts,tsx}',
      'scripts/**/*.{ts,tsx,mjs,js}',
      '*.{mjs,js,ts}',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Type-aware rules for every workspace whose files belong to a tsconfig
    // project. `scripts/` and root config files are intentionally excluded:
    // they are executed by tsx and are not part of a tsconfig project.
    files: [
      'apps/api/**/*.{ts,tsx}',
      'apps/console/**/*.{ts,tsx}',
      'apps/ui/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'e2e/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `void promise` is the codebase's explicit fire-and-forget marker.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['apps/ui/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  prettier,
);
