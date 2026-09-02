import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.wrangler',
      'worker-configuration.d.ts',
      'drizzle/meta',
      'playwright-report',
      'test-results',
      'vitest.worker.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/app/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler-era rules that flag common, intentional patterns (latest-ref, deriving
      // state from URL/query data, `new Date()` in menus). Re-enable when adopting the compiler.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/worker/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.serviceworker, ...globals.node },
    },
  },
  {
    files: ['scripts/**/*.{mjs,ts}', '*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    },
  },
);
