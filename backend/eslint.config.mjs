import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

/**
 * RF0 (structural refactor, Phase 1). This config exists for exactly one job: pin the layer
 * boundaries from ROADMAP § *Target Repository Structure* so the relocation can't be undone by a
 * stray import. The target directories (`src/core`, `src/infra`, `src/http`, `src/modules`) do
 * not exist yet — the zones below match nothing until RF2/RF3 create them, then bite. General
 * code-quality linting on the backend is deliberately out of scope here.
 */
const BOUNDARY_ZONES = [
    {
        target: './src/core/**',
        from: ['./src/modules/**', './src/infra/**', './src/http/**'],
        message:
            'core/ is framework-agnostic: it may import @shared only, never modules/, infra/ or http/.',
    },
    {
        target: './src/infra/**',
        from: ['./src/modules/**', './src/http/**'],
        message: 'infra/ holds external clients: it may import @core only, never modules/ or http/.',
    },
    {
        // A feature module may reach into `http/middleware` — `*.routes.ts` wires `protect`,
        // the rate limiters and `sanitizeBody`, and that is the one http→module edge the
        // placement contract (ROADMAP § Target Repository Structure) sanctions. It must never
        // import the app shell itself (`http/app.ts`) or the mount table (`http/routes.ts`) —
        // the shell wires modules, not the reverse.
        target: './src/modules/**',
        from: ['./src/http/app.ts', './src/http/routes.ts', './src/http/health.routes.ts'],
        message: 'A feature module must not import the app shell or the route mount table — the shell wires modules, not the reverse. (http/middleware is fine — routes wire it.)',
    },
]

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'uploads/**',
            'coverage/**',
            '../dist/**',
        ],
    },
    {
        files: ['**/*.ts', '**/*.mts'],
        extends: [js.configs.recommended],
        // Existing source carries `eslint-disable` directives for @typescript-eslint rules that a
        // later refactor phase (RF15) will turn on. They read as "unused" here only because those
        // rules aren't enabled yet — don't report them so nobody deletes a directive that will
        // matter again.
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node },
        },
        // @typescript-eslint is registered so existing inline `eslint-disable` directives that
        // name its rules still resolve — but none of its rules are enabled (RF0 is boundaries only).
        plugins: { 'import-x': importX, '@typescript-eslint': tseslint.plugin },
        settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
        },
        rules: {
            // TS handles these; the base rules only add noise on a typed codebase.
            'no-undef': 'off',
            'no-unused-vars': 'off',
            'no-redeclare': 'off',
            'no-dupe-class-members': 'off',
            'import-x/no-restricted-paths': ['error', { zones: BOUNDARY_ZONES }],
        },
    },
    {
        // RF4: co-located suites live under `src/**/__tests__/` and legitimately import across
        // module and layer boundaries (an integration test drives several modules; a `core/`
        // plugin test seeds real module models). The boundary zones guard production code only —
        // `architecture.test.ts` already skips `__tests__/` for the same reason.
        files: ['**/__tests__/**', 'tests/**'],
        rules: { 'import-x/no-restricted-paths': 'off' },
    },
)
