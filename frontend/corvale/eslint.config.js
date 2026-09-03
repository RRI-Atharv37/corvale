import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

/**
 * RF0/RF6 (structural refactor, Phase 1). The `no-restricted-paths` zones pin the layer
 * boundaries from ROADMAP § *Target Repository Structure*: the design system (`ui/`) never
 * reaches into features/app/platform/domain, `lib/` stays a leaf, the pure `domain/` engine
 * takes no UI import, and `platform/` is consumed by features/app rather than the reverse.
 * RF6 created the dirs and (user decision) relocated every offending file so all four zones
 * pass as `error` on production code. The zones apply to production modules only — a test that
 * renders a provider or a feature page is not an architecture violation, so the test-file glob
 * block at the end of this config turns the rule off for tests. RF15 tightens further once RF14
 * normalises the layering.
 */
const BOUNDARY_ZONES = [
  {
    target: './src/ui/**',
    from: ['./src/features/**', './src/app/**', './src/platform/**', './src/domain/**'],
    message: 'ui/ is the design system — it may import lib/ only, never features/, app/, platform/ or domain/.',
  },
  {
    target: './src/lib/**',
    from: ['./src/features/**', './src/app/**', './src/ui/**', './src/platform/**', './src/domain/**'],
    message: 'lib/ holds leaf utilities — it must not import app-layer code.',
  },
  {
    target: './src/domain/**',
    from: ['./src/features/**', './src/app/**', './src/ui/**'],
    message: 'domain/ is the pure local-first engine — no features/, app/ or ui/ imports.',
  },
  {
    target: './src/platform/**',
    from: ['./src/features/**', './src/app/**'],
    message: 'platform/ is the local-first runtime — features/app consume it, not the reverse.',
  },
]

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target'] },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Sprint 13.9 introduced `@shared/*`-imported pure functions and index-signature-backed
      // local record types (SyncableRecord) throughout the sync/domain layer; `no-explicit-any`
      // and `no-empty-object-type` fire on legitimate patterns there. Everything else in the
      // recommended set stays on.
      '@typescript-eslint/no-explicit-any': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'import-x/no-restricted-paths': ['error', { zones: BOUNDARY_ZONES }],
    },
  },
  {
    // Boundary zones guard production layering; test modules legitimately import across layers
    // (a feature test renders providers, a platform test imports a page). See the note above.
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      'import-x/no-restricted-paths': 'off',
    },
  }
)
