import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'

import defaultApp from '@http/app'
import { ADMIN_BASE, ADMIN_ORIGIN, buildAdminApp, disableAdmin } from '@tests/adminHelpers'

/**
 * M7.1 - the admin boundary is enforced by structure, not convention (plan §1): the admin module
 * can only see billing/account metadata, and its privileged database access lives in one file.
 */

const BACKEND_ROOT = resolve(__dirname, '..', '..')
const ADMIN_DIR = join(BACKEND_ROOT, 'src', 'modules', 'admin')

const adminSourceFiles = (dir: string = ADMIN_DIR): string[] => {
    if (!existsSync(dir)) return []
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
            if (entry !== '__tests__') out.push(...adminSourceFiles(full))
        } else if (entry.endsWith('.ts')) {
            out.push(full)
        }
    }
    return out
}

const rel = (file: string): string => relative(BACKEND_ROOT, file).split(/[\\/]/).join('/')

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g
const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(IMPORT_RE)].map((m) => m[1])

const ALLOWED_MODULES = new Set(['billing', 'users', 'workspaces'])

afterAll(() => {
    disableAdmin()
})

describe('admin module boundary', () => {
    it('exists with an index and a routes file', () => {
        expect(existsSync(join(ADMIN_DIR, 'index.ts'))).toBe(true)
        expect(readdirSync(ADMIN_DIR).some((name) => name.endsWith('.routes.ts'))).toBe(true)
    })

    it('imports only the billing, users and workspaces modules', () => {
        const violations: string[] = []
        for (const file of adminSourceFiles()) {
            for (const spec of importsOf(file)) {
                const alias = spec.match(/^@modules\/([^/]+)/)
                if (alias && alias[1] !== 'admin' && !ALLOWED_MODULES.has(alias[1])) {
                    violations.push(`${rel(file)} -> ${spec}`)
                }
                if (spec.startsWith('..') && /modules\//.test(spec)) violations.push(`${rel(file)} -> ${spec}`)
            }
        }

        expect(violations, `the admin module reached past its boundary:\n${violations.join('\n')}`).toEqual([])
    })

    it('never names a financial-content model', () => {
        const forbidden =
            /\b(Transaction|Account|Receipt|Budget|SavingsGoal|SavingsGoalContribution|RecurringRule|Category|Tag|CategorizationRule|TransactionTemplate|SavedReport|ReconciliationSession|Saver|Pushover|Income|Expense)\b\s*[.,}]/
        const offenders = adminSourceFiles()
            .filter((file) => forbidden.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
            .map(rel)

        expect(offenders, `financial-content models referenced in: ${offenders.join(', ')}`).toEqual([])
    })

    it('only reads the workspace model for ids and counts, never names', () => {
        for (const file of adminSourceFiles()) {
            const source = readFileSync(file, 'utf8')
            if (!/Workspace\./.test(source)) continue
            expect(source, rel(file)).toMatch(/select\(['"][^'"]*['"]\)/)
            expect(source, rel(file)).not.toMatch(/select\(['"][^'"]*\bname\b/)
        }
    })

    it('confines RLS_BYPASS to a single data-access service file', () => {
        const users = adminSourceFiles().filter((file) => /RLS_BYPASS/.test(readFileSync(file, 'utf8')))

        expect(users.map(rel)).toEqual(['src/modules/admin/adminData.service.ts'])
    })

    it('uses no cross-collection aggregation stage', () => {
        const offenders = adminSourceFiles().filter((file) =>
            /\$lookup|\$graphLookup|\$unionWith/.test(readFileSync(file, 'utf8'))
        )

        expect(offenders.map(rel)).toEqual([])
    })

    it('keeps controllers free of Mongoose calls and services free of Express', () => {
        for (const file of adminSourceFiles()) {
            const source = readFileSync(file, 'utf8')
            if (file.endsWith('.controller.ts')) {
                expect(source, rel(file)).not.toMatch(/\b[A-Z][A-Za-z]+\.(find|findOne|findById|create|aggregate|updateOne|updateMany|deleteOne|deleteMany|countDocuments)\(/)
            }
            if (file.endsWith('.service.ts')) {
                expect(importsOf(file), rel(file)).not.toContain('express')
            }
        }
    })
})

describe('conditional mount', () => {
    const PUBLIC = ['auth/login', 'auth/refresh', 'auth/logout', 'auth/enrol/start', 'auth/enrol/complete']
    const PROTECTED_GET = ['auth/me', 'admins', 'audit']
    const PROTECTED_POST = ['auth/step-up', 'admins/invite']

    it('does not exist while ADMIN_ENABLED is unset: every admin path is a 404 on the ordinary app', async () => {
        for (const path of [...PUBLIC, ...PROTECTED_POST]) {
            expect((await request(defaultApp).post(`${ADMIN_BASE}/${path}`).send({})).status, path).toBe(404)
        }
        for (const path of PROTECTED_GET) {
            expect((await request(defaultApp).get(`${ADMIN_BASE}/${path}`)).status, path).toBe(404)
        }
    })

    it('does not exist when ADMIN_ENABLED is anything but "true"', async () => {
        process.env.ADMIN_ENABLED = '1'
        const app = buildAdminApp({ ADMIN_ENABLED: '1' })

        expect((await request(app).get(`${ADMIN_BASE}/auth/me`)).status).toBe(404)
        disableAdmin()
    })

    it('when enabled, every protected route answers 401 without a token', async () => {
        const app = buildAdminApp()

        for (const path of PROTECTED_GET) {
            expect((await request(app).get(`${ADMIN_BASE}/${path}`)).status, path).toBe(401)
        }
        for (const path of PROTECTED_POST) {
            expect((await request(app).post(`${ADMIN_BASE}/${path}`).send({})).status, path).toBe(401)
        }
    })

    it('answers 404 to a caller outside ADMIN_IP_ALLOWLIST, even with valid credentials elsewhere', async () => {
        const app = buildAdminApp({ ADMIN_IP_ALLOWLIST: '203.0.113.50' })

        expect((await request(app).get(`${ADMIN_BASE}/auth/me`)).status).toBe(404)
        expect((await request(app).post(`${ADMIN_BASE}/auth/login`).send({})).status).toBe(404)
    })

    it('admits a caller on ADMIN_IP_ALLOWLIST', async () => {
        const app = buildAdminApp({ ADMIN_IP_ALLOWLIST: '203.0.113.50, ::ffff:127.0.0.1, 127.0.0.1, ::1' })

        expect((await request(app).get(`${ADMIN_BASE}/auth/me`)).status).toBe(401)
    })
})

describe('CORS', () => {
    it('allows the admin origin on admin routes, and only there', async () => {
        const app = buildAdminApp()

        const admin = await request(app).options(`${ADMIN_BASE}/auth/login`).set('Origin', ADMIN_ORIGIN).set('Access-Control-Request-Method', 'POST')
        const user = await request(app).options('/api/v1/transactions').set('Origin', ADMIN_ORIGIN).set('Access-Control-Request-Method', 'POST')

        expect(admin.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN)
        expect(admin.headers['access-control-allow-credentials']).toBe('true')
        expect(user.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('refuses the user-app origin on admin routes', async () => {
        const app = buildAdminApp()

        const res = await request(app)
            .options(`${ADMIN_BASE}/auth/login`)
            .set('Origin', process.env.CLIENT_URL as string)
            .set('Access-Control-Request-Method', 'POST')

        expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
})
