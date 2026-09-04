import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * RF0 (structural refactor, Phase 1) — the boundary guard, written before any file moves.
 *
 * It encodes the module/layer contract from ROADMAP § *Target Repository Structure*. The target
 * layout (`src/http`, `src/core`, `src/infra`, `src/modules`) does not exist yet, so every
 * assertion below passes vacuously today and starts biting as RF2/RF3 relocate code into those
 * directories. The set of `it()` blocks is fixed — each one scans whatever exists rather than
 * generating a case per module — so the count stays stable for the RF9 parity check.
 */

const BACKEND_ROOT = resolve(__dirname, '..', '..')
const SRC = join(BACKEND_ROOT, 'src')
const MODULES_DIR = join(SRC, 'modules')
const CORE_DIR = join(SRC, 'core')
const INFRA_DIR = join(SRC, 'infra')
const ROUTES_TABLE = join(SRC, 'http', 'routes.ts')

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g

const listDirs = (dir: string): string[] =>
    existsSync(dir)
        ? readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory())
        : []

const walkTsFiles = (dir: string): string[] => {
    if (!existsSync(dir)) return []
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules' || entry === '__tests__') continue
            out.push(...walkTsFiles(full))
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
            out.push(full)
        }
    }
    return out
}

const importSpecifiers = (file: string): string[] => {
    const src = readFileSync(file, 'utf8')
    const specs: string[] = []
    for (const match of src.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2]
        if (spec) specs.push(spec)
    }
    return specs
}

/** Resolve a relative import to an absolute path (no extension); non-relative specs return null. */
const resolveRelative = (fromFile: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null
    return resolve(dirname(fromFile), spec)
}

describe('architecture — module structure (RF0 guard, latent until RF3)', () => {
    it('every src/modules/* exposes an index.ts', () => {
        const offenders = listDirs(MODULES_DIR).filter(
            (mod) => !existsSync(join(MODULES_DIR, mod, 'index.ts'))
        )
        expect(offenders, `modules missing index.ts: ${offenders.join(', ')}`).toEqual([])
    })

    it('every src/modules/* exposes a *.routes.ts', () => {
        const offenders = listDirs(MODULES_DIR).filter((mod) => {
            const files = existsSync(join(MODULES_DIR, mod))
                ? readdirSync(join(MODULES_DIR, mod))
                : []
            return !files.some((f) => f.endsWith('.routes.ts'))
        })
        expect(offenders, `modules missing *.routes.ts: ${offenders.join(', ')}`).toEqual([])
    })

    it('no file imports another module past its index.ts', () => {
        const violations: string[] = []
        for (const mod of listDirs(MODULES_DIR)) {
            const modDir = join(MODULES_DIR, mod)
            for (const file of walkTsFiles(modDir)) {
                for (const spec of importSpecifiers(file)) {
                    const target = resolveRelative(file, spec)
                    if (!target) continue
                    const rel = relative(MODULES_DIR, target).split(/[\\/]/)
                    const [otherMod, ...rest] = rel
                    if (
                        otherMod &&
                        otherMod !== mod &&
                        !otherMod.startsWith('..') &&
                        listDirs(MODULES_DIR).includes(otherMod) &&
                        rest.join('/') !== 'index'
                    ) {
                        violations.push(`${relative(BACKEND_ROOT, file)} → ${spec}`)
                    }
                }
            }
        }
        expect(violations, `cross-module deep imports:\n${violations.join('\n')}`).toEqual([])
    })
})

describe('architecture — layer purity (RF0 guard, latent until RF2)', () => {
    it('src/core/** imports nothing from modules/ or infra/', () => {
        const violations: string[] = []
        for (const file of walkTsFiles(CORE_DIR)) {
            for (const spec of importSpecifiers(file)) {
                const target = resolveRelative(file, spec)
                const abs = target ?? ''
                if (
                    abs.startsWith(MODULES_DIR) ||
                    abs.startsWith(INFRA_DIR) ||
                    spec.startsWith('@modules/') ||
                    spec.startsWith('@infra/')
                ) {
                    violations.push(`${relative(BACKEND_ROOT, file)} → ${spec}`)
                }
            }
        }
        expect(violations, `core/ reaching outward:\n${violations.join('\n')}`).toEqual([])
    })

    it('src/infra/** imports nothing from modules/', () => {
        const violations: string[] = []
        for (const file of walkTsFiles(INFRA_DIR)) {
            for (const spec of importSpecifiers(file)) {
                const target = resolveRelative(file, spec)
                if ((target ?? '').startsWith(MODULES_DIR) || spec.startsWith('@modules/')) {
                    violations.push(`${relative(BACKEND_ROOT, file)} → ${spec}`)
                }
            }
        }
        expect(violations, `infra/ reaching into modules/:\n${violations.join('\n')}`).toEqual([])
    })
})

describe('architecture — route mount table (RF0 guard, latent until RF3)', () => {
    it('every module base path in http/routes.ts resolves to a real module directory', () => {
        if (!existsSync(ROUTES_TABLE)) return
        const src = readFileSync(ROUTES_TABLE, 'utf8')
        const moduleImports = [...src.matchAll(/from\s*['"](?:@modules\/|\.\.\/modules\/)([^'"/]+)/g)].map(
            (m) => m[1]
        )
        const known = listDirs(MODULES_DIR)
        const dangling = moduleImports.filter((mod) => !known.includes(mod))
        expect(dangling, `routes.ts references non-existent modules: ${dangling.join(', ')}`).toEqual(
            []
        )
    })
})

/**
 * RF15 (Phase 3) — the intra-module contract. A `*.controller.ts` runs no Mongoose query of its
 * own and does no minor-unit money math; a `*.service.ts` never touches Express. `eslint.config.mjs`
 * enforces the same thing as a lint error — this is the redundant, CI-cheap backstop and the home
 * of the ratchet: `CONTROLLERS_WITH_LEGACY_DB_ACCESS` is the set RF14 has not yet normalized and it
 * may only shrink.
 */
const moduleFiles = (suffix: string): string[] => {
    const out: string[] = []
    for (const mod of listDirs(MODULES_DIR)) {
        const dir = join(MODULES_DIR, mod)
        for (const entry of readdirSync(dir)) {
            if (entry.endsWith(suffix) && statSync(join(dir, entry)).isFile()) {
                out.push(join(dir, entry))
            }
        }
    }
    return out
}

const relPosix = (file: string): string => relative(BACKEND_ROOT, file).split(/[\\/]/).join('/')

// Kept byte-identical to CONTROLLERS_WITH_LEGACY_DB_ACCESS in eslint.config.mjs.
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
].sort()

const MONGOOSE_CALL_RE =
    /\b[A-Z][A-Za-z]+\.(find|findOne|findById|findByIdAndUpdate|findOneAndUpdate|findByIdAndDelete|findOneAndDelete|findOneAndReplace|create|aggregate|updateOne|updateMany|replaceOne|deleteOne|deleteMany|countDocuments|estimatedDocumentCount|insertMany|bulkWrite|distinct)\(/

describe('architecture — intra-module contract (RF15)', () => {
    it('a normalized *.controller.ts issues no Mongoose query of its own', () => {
        const offenders = moduleFiles('.controller.ts')
            .filter((file) => MONGOOSE_CALL_RE.test(readFileSync(file, 'utf8')))
            .map(relPosix)
            .sort()

        const newViolations = offenders.filter(
            (f) => !CONTROLLERS_WITH_LEGACY_DB_ACCESS.includes(f)
        )
        expect(
            newViolations,
            `controllers running their own Mongoose query (move it to the *.service.ts):\n${newViolations.join('\n')}`
        ).toEqual([])

        const staleExceptions = CONTROLLERS_WITH_LEGACY_DB_ACCESS.filter(
            (f) => !offenders.includes(f)
        )
        expect(
            staleExceptions,
            `RF14 has normalized these — drop them from CONTROLLERS_WITH_LEGACY_DB_ACCESS here and in eslint.config.mjs:\n${staleExceptions.join('\n')}`
        ).toEqual([])
    })

    it('a normalized *.controller.ts imports no @shared money-math module', () => {
        const mathModules = [
            '@shared/money',
            '@shared/balances',
            '@shared/budget',
            '@shared/savingsGoals',
            '@shared/forecast',
        ]
        const offenders: string[] = []
        for (const file of moduleFiles('.controller.ts')) {
            if (CONTROLLERS_WITH_LEGACY_DB_ACCESS.includes(relPosix(file))) continue
            for (const spec of importSpecifiers(file)) {
                if (mathModules.includes(spec)) {
                    offenders.push(`${relPosix(file)} → ${spec}`)
                }
            }
        }
        expect(
            offenders,
            `money math belongs in the service or a domain file:\n${offenders.join('\n')}`
        ).toEqual([])
    })

    it('a *.service.ts imports no Express', () => {
        const offenders: string[] = []
        for (const file of moduleFiles('.service.ts')) {
            for (const spec of importSpecifiers(file)) {
                if (spec === 'express' || spec === 'express-async-handler') {
                    offenders.push(`${relPosix(file)} → ${spec}`)
                }
            }
        }
        expect(
            offenders,
            `a *.service.ts takes plain arguments — no Express:\n${offenders.join('\n')}`
        ).toEqual([])
    })
})
