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
 *
 * RF15 (Phase 3) adds the intra-module contract on top: a `*.controller.ts` runs no Mongoose
 * query of its own and does no minor-unit money math (both belong in `*.service.ts` or a domain
 * file); a `*.service.ts` never touches Express. Enforced as an `error` for every module — the
 * `CONTROLLERS_WITH_LEGACY_DB_ACCESS` list is the set RF14 has NOT yet normalized, and it may
 * only shrink (`architecture.test.ts` fails on a stale entry).
 */

// Mongoose query/mutation surface — mirrors QUERY_OPERATIONS in rowLevelSecurityPlugin.ts.
const MONGOOSE_QUERY_METHODS =
    'find|findOne|findById|findByIdAndUpdate|findOneAndUpdate|findByIdAndDelete|findOneAndDelete|' +
    'findOneAndReplace|create|aggregate|updateOne|updateMany|replaceOne|deleteOne|deleteMany|' +
    'countDocuments|estimatedDocumentCount|insertMany|bulkWrite|distinct'

// A `Foo.find(` / `Budget.create(` style call — capitalised receiver identifier so `arr.find(`,
// `Promise.all(`, `Object.assign(` etc. don't match.
const MONGOOSE_CALL_SELECTOR =
    `CallExpression[callee.type='MemberExpression']` +
    `[callee.object.type='Identifier'][callee.object.name=/^[A-Z]/]` +
    `[callee.property.name=/^(${MONGOOSE_QUERY_METHODS})$/]`

// Controllers RF14 has not reached yet — thin-CRUD modules where the money-bearing pass was
// deliberately skipped (TODO.md § RF14). Every entry still runs its own Mongoose calls. This list
// may only get shorter.
const CONTROLLERS_WITH_LEGACY_DB_ACCESS = [
    'src/modules/auth/auth.controller.ts',
    'src/modules/calendar/calendar.controller.ts',
    'src/modules/categories/category.controller.ts',
    'src/modules/categorization-rules/categorizationRule.controller.ts',
    'src/modules/debts/debt.controller.ts',
    'src/modules/exchange-rates/exchangeRate.controller.ts',
    'src/modules/legacy/expense.controller.ts',
    'src/modules/legacy/income.controller.ts',
    'src/modules/notifications/notification.controller.ts',
    'src/modules/onboarding/onboarding.controller.ts',
    'src/modules/receipts/receipt.controller.ts',
    'src/modules/reconciliation/reconciliation.controller.ts',
    'src/modules/recurring/recurringRule.controller.ts',
    'src/modules/savers/pushover.controller.ts',
    'src/modules/savers/saver.controller.ts',
    'src/modules/subscriptions/subscription.controller.ts',
    'src/modules/tags/tag.controller.ts',
    'src/modules/transaction-templates/transactionTemplate.controller.ts',
    'src/modules/users/user.controller.ts',
    'src/modules/workspaces/workspace.controller.ts',
]

const CONTROLLER_MONEY_MATH_IMPORTS = [
    '@shared/money',
    '@shared/balances',
    '@shared/budget',
    '@shared/savingsGoals',
    '@shared/forecast',
]
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
        // RF15: the controller half of the intra-module contract — no self-issued Mongoose query,
        // no minor-unit money math.
        files: ['src/modules/**/*.controller.ts'],
        ignores: CONTROLLERS_WITH_LEGACY_DB_ACCESS,
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: MONGOOSE_CALL_SELECTOR,
                    message:
                        'RF14/RF15 contract: a *.controller.ts runs no Mongoose query of its own — move it into the module *.service.ts.',
                },
            ],
            'no-restricted-imports': [
                'error',
                {
                    paths: CONTROLLER_MONEY_MATH_IMPORTS.map((name) => ({
                        name,
                        message:
                            'RF14/RF15 contract: minor-unit money math belongs in the module service or a domain file, not the controller.',
                    })),
                },
            ],
        },
    },
    {
        // RF15: a *.service.ts is Express-free (it takes plain inputs, never req/res).
        files: ['src/modules/**/*.service.ts'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: "TSTypeReference[typeName.name=/^(Request|Response|NextFunction)$/]",
                    message:
                        'RF14/RF15 contract: a *.service.ts takes plain arguments — no Express Request/Response/NextFunction.',
                },
            ],
            'no-restricted-imports': [
                'error',
                {
                    paths: [
                        {
                            name: 'express',
                            message:
                                'RF14/RF15 contract: a *.service.ts must not import Express — keep the HTTP layer in the controller.',
                        },
                    ],
                },
            ],
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
