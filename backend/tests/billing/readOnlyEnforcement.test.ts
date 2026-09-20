import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Transaction } from '@modules/transactions'
import { RECEIPT_UPLOAD_ROOT } from '@modules/receipts/receiptUtils'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser, type RegisteredUser } from '@tests/helpers'
import {
    BILLING_STATES,
    READ_ONLY_STATES,
    createAccountViaApi,
    createExpenseViaApi,
    disableBilling,
    enableBilling,
    getFoodMasterId,
    randomId,
    seedTestPlans,
    setSubscription,
} from '@tests/billingHelpers'

/**
 * M1 - the read-only state (trial_expired / cancelled / lapsed dunning / no subscription) enforced
 * at the API, per ROADMAP § *Trial and downgrade semantics*: every read, export and sync-pull still
 * works; every write is refused with 402 READ_ONLY - before body validation and before any lookup.
 * Nothing is deleted by the state change.
 *
 * The route tables below classify EVERY mutating route the API registers. The drift guard at the
 * bottom fails when a `router.post|put|patch|delete` is added without being classified here, so a
 * new write endpoint cannot ship un-gated by accident.
 */

type Method = 'post' | 'put' | 'patch' | 'delete'
interface RouteCase {
    method: Method
    path: string
    file?: { field: string; filename: string; contentType: string; content: Buffer }
}

const id = randomId
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF')
const receiptFile = { field: 'receipt', filename: 'r.pdf', contentType: 'application/pdf', content: PDF }
const backupFile = { field: 'file', filename: 'b.zip', contentType: 'application/zip', content: Buffer.from('PK') }

const GATED: RouteCase[] = [
    { method: 'post', path: '/api/v1/accounts' },
    { method: 'post', path: `/api/v1/accounts/${id()}/recompute-balance` },
    { method: 'put', path: `/api/v1/accounts/${id()}` },
    { method: 'delete', path: `/api/v1/accounts/${id()}` },
    { method: 'post', path: '/api/v1/budgets' },
    { method: 'put', path: `/api/v1/budgets/${id()}` },
    { method: 'delete', path: `/api/v1/budgets/${id()}` },
    { method: 'post', path: '/api/v1/categories' },
    { method: 'put', path: '/api/v1/categories/reorder' },
    { method: 'put', path: `/api/v1/categories/${id()}` },
    { method: 'delete', path: `/api/v1/categories/${id()}` },
    { method: 'post', path: '/api/v1/categorization-rules/bulk-apply' },
    { method: 'post', path: '/api/v1/categorization-rules' },
    { method: 'put', path: `/api/v1/categorization-rules/${id()}` },
    { method: 'delete', path: `/api/v1/categorization-rules/${id()}` },
    { method: 'post', path: '/api/v1/exchange-rates' },
    { method: 'patch', path: '/api/v1/exchange-rates/USD-EUR' },
    { method: 'delete', path: '/api/v1/exchange-rates/USD-EUR' },
    { method: 'post', path: '/api/v1/imports/commit' },
    { method: 'post', path: '/api/v1/expense/create' },
    { method: 'post', path: `/api/v1/expense/duplicate/${id()}` },
    { method: 'put', path: `/api/v1/expense/${id()}` },
    { method: 'delete', path: `/api/v1/expense/${id()}` },
    { method: 'post', path: '/api/v1/income/create' },
    { method: 'post', path: `/api/v1/income/duplicate/${id()}` },
    { method: 'put', path: `/api/v1/income/${id()}` },
    { method: 'delete', path: `/api/v1/income/${id()}` },
    { method: 'post', path: '/api/v1/receipts', file: receiptFile },
    { method: 'delete', path: `/api/v1/receipts/${id()}` },
    { method: 'post', path: '/api/v1/reconciliation-sessions' },
    { method: 'post', path: '/api/v1/recurring-rules' },
    { method: 'post', path: '/api/v1/recurring-rules/generate-drafts' },
    { method: 'post', path: `/api/v1/recurring-rules/drafts/${id()}/confirm` },
    { method: 'post', path: `/api/v1/recurring-rules/drafts/${id()}/dismiss` },
    { method: 'post', path: `/api/v1/recurring-rules/${id()}/generate-drafts` },
    { method: 'put', path: `/api/v1/recurring-rules/${id()}` },
    { method: 'delete', path: `/api/v1/recurring-rules/${id()}` },
    { method: 'post', path: '/api/v1/dashboard/reports/saved' },
    { method: 'put', path: `/api/v1/dashboard/reports/saved/${id()}` },
    { method: 'delete', path: `/api/v1/dashboard/reports/saved/${id()}` },
    { method: 'post', path: '/api/v1/saver/add' },
    { method: 'post', path: '/api/v1/saver/withdraw' },
    { method: 'post', path: '/api/v1/pushover/pushover' },
    { method: 'post', path: '/api/v1/savings-goals' },
    { method: 'post', path: `/api/v1/savings-goals/${id()}/contribute` },
    { method: 'post', path: `/api/v1/savings-goals/${id()}/auto-contribute` },
    { method: 'post', path: `/api/v1/savings-goals/${id()}/pause` },
    { method: 'post', path: `/api/v1/savings-goals/${id()}/resume` },
    { method: 'post', path: `/api/v1/savings-goals/${id()}/complete` },
    { method: 'put', path: `/api/v1/savings-goals/${id()}` },
    { method: 'delete', path: `/api/v1/savings-goals/${id()}` },
    { method: 'post', path: '/api/v1/sync/push' },
    { method: 'post', path: '/api/v1/tags/dedupe' },
    { method: 'post', path: '/api/v1/tags' },
    { method: 'put', path: `/api/v1/tags/${id()}` },
    { method: 'delete', path: `/api/v1/tags/${id()}` },
    { method: 'post', path: `/api/v1/transaction-templates/${id()}/apply` },
    { method: 'post', path: '/api/v1/transaction-templates' },
    { method: 'put', path: `/api/v1/transaction-templates/${id()}` },
    { method: 'delete', path: `/api/v1/transaction-templates/${id()}` },
    { method: 'post', path: '/api/v1/transactions' },
    { method: 'post', path: '/api/v1/transactions/transfer' },
    { method: 'post', path: '/api/v1/transactions/bulk/delete' },
    { method: 'patch', path: '/api/v1/transactions/bulk/category' },
    { method: 'post', path: `/api/v1/transactions/duplicate/${id()}` },
    { method: 'patch', path: `/api/v1/transactions/${id()}/cleared-status` },
    { method: 'post', path: `/api/v1/transactions/${id()}/receipts` },
    { method: 'delete', path: `/api/v1/transactions/${id()}/receipts/${id()}` },
    { method: 'put', path: `/api/v1/transactions/${id()}` },
    { method: 'delete', path: `/api/v1/transactions/${id()}` },
    { method: 'post', path: '/api/v1/workspaces' },
    { method: 'post', path: '/api/v1/backup/restore', file: backupFile },
]

/** Authenticated routes that must keep working in a read-only state: they write nothing the user owns, or must never be lockable. */
const EXEMPT: RouteCase[] = [
    { method: 'post', path: '/api/v1/categorization-rules/test' },
    { method: 'post', path: '/api/v1/imports/parse' },
    { method: 'post', path: '/api/v1/imports/preview' },
    { method: 'post', path: '/api/v1/debts/plan' },
    { method: 'post', path: '/api/v1/dashboard/reports/query' },
    { method: 'post', path: '/api/v1/dashboard/reports/generate' },
    { method: 'post', path: '/api/v1/backup/preview', file: backupFile },
    { method: 'patch', path: '/api/v1/notifications/read-all' },
    { method: 'patch', path: `/api/v1/notifications/${id()}/read` },
    { method: 'patch', path: `/api/v1/notifications/${id()}/dismiss` },
    { method: 'post', path: '/api/v1/onboarding/start' },
    { method: 'post', path: '/api/v1/onboarding/step/1' },
    { method: 'patch', path: '/api/v1/onboarding/skip' },
    { method: 'post', path: '/api/v1/onboarding/replay' },
    { method: 'patch', path: '/api/v1/auth/user' },
    { method: 'post', path: '/api/v1/auth/legal/accept' },
    { method: 'delete', path: '/api/v1/auth/account' },
    { method: 'post', path: '/api/v1/auth/logout-all' },
    { method: 'post', path: `/api/v1/workspaces/invites/${id()}/accept` },
    { method: 'post', path: `/api/v1/workspaces/invites/${id()}/decline` },
    { method: 'post', path: '/api/v1/billing/checkout' },
    { method: 'post', path: '/api/v1/billing/portal' },
]

/** Routes with no user session: classified for the drift guard, exercised in their own suites. */
const UNAUTHENTICATED: RouteCase[] = [
    { method: 'post', path: '/api/v1/auth/register' },
    { method: 'post', path: '/api/v1/auth/login' },
    { method: 'post', path: '/api/v1/auth/refresh' },
    { method: 'post', path: '/api/v1/auth/logout' },
    { method: 'post', path: '/api/v1/auth/password-reset/request' },
    { method: 'post', path: '/api/v1/auth/password-reset/confirm' },
    { method: 'post', path: '/api/v1/auth/email-verification/confirm' },
    { method: 'post', path: '/api/v1/auth/email-verification/resend' },
    { method: 'post', path: '/api/v1/billing/webhook' },
]

/** Resolve their gate from the WORKSPACE OWNER's subscription - see workspaceEntitlements.test.ts. */
const WORKSPACE_SCOPED: RouteCase[] = [
    { method: 'patch', path: '/api/v1/workspaces/:workspaceId' },
    { method: 'post', path: '/api/v1/workspaces/:workspaceId/members' },
    { method: 'patch', path: '/api/v1/workspaces/:workspaceId/members/:memberUserId' },
    { method: 'delete', path: '/api/v1/workspaces/:workspaceId/members/:memberUserId' },
]

const send = (token: string, route: RouteCase) => {
    const req = request(app)[route.method](route.path).set(authHeader(token))
    if (route.file) {
        return req.attach(route.file.field, route.file.content, {
            filename: route.file.filename,
            contentType: route.file.contentType,
        })
    }
    return req.send({})
}

const label = (r: RouteCase) => `${r.method.toUpperCase()} ${r.path.replace(/[0-9a-f]{24}/g, ':id')}`

afterEach(() => {
    disableBilling()
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('read-only state - every write is refused at the API', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.trial_expired)
    })

    it.each(GATED.map((r) => [label(r), r] as const))('%s -> 402 READ_ONLY', async (_name, route) => {
        const res = await send(user.token, route)

        expect(res.status).toBe(402)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it.each(EXEMPT.map((r) => [label(r), r] as const))('%s is not gated', async (_name, route) => {
        const res = await send(user.token, route)

        expect(res.status).not.toBe(402)
    })

    it.each(READ_ONLY_STATES)('POST /accounts is refused in the %s state', async (state) => {
        await setSubscription(user.userId, BILLING_STATES[state])

        const res = await request(app).post('/api/v1/accounts').set(authHeader(user.token)).send({
            name: 'Nope',
            type: 'checking',
            openingBalance: 1,
        })

        expect(res.status).toBe(402)
        expect(await Account.countDocuments({ userId: user.userId })).toBe(0)
    })

    it('a user with no subscription row at all is read-only', async () => {
        const { Subscription } = await import('@modules/billing')
        await Subscription.deleteMany({ userId: user.userId })

        const res = await request(app).post('/api/v1/accounts').set(authHeader(user.token)).send({
            name: 'Nope',
            type: 'checking',
            openingBalance: 1,
        })

        expect(res.status).toBe(402)
        expect(res.body.message).toBe(ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('refuses before validating the body (an empty payload is 402, not 400)', async () => {
        const res = await request(app).post('/api/v1/transactions').set(authHeader(user.token)).send({})

        expect(res.status).toBe(402)
    })

    it('a stored `trialing` row past trialEndsAt is refused with no expiry job having run', async () => {
        await setSubscription(user.userId, BILLING_STATES.trialing_but_lapsed)

        const res = await request(app).post('/api/v1/tags').set(authHeader(user.token)).send({ name: 'x' })

        expect(res.status).toBe(402)
    })
})

describe('read-only state - reads, export and sync-pull are untouched, and no data is lost', () => {
    let user: RegisteredUser
    let accountId: string
    let categoryId: string

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)

        accountId = await createAccountViaApi(app, user.token)
        categoryId = await getFoodMasterId(app, user.token)
        const tx = await createExpenseViaApi(app, user.token, accountId, categoryId)
        expect(tx.status).toBe(201)

        await setSubscription(user.userId, BILLING_STATES.trial_expired)
    })

    const READS = [
        '/api/v1/accounts',
        '/api/v1/transactions',
        '/api/v1/budgets',
        '/api/v1/categories',
        '/api/v1/tags',
        '/api/v1/savings-goals',
        '/api/v1/recurring-rules',
        '/api/v1/notifications',
        '/api/v1/workspaces',
        '/api/v1/auth/user',
        '/api/v1/backup/export',
        '/api/v1/sync/bootstrap',
        '/api/v1/sync/pull',
    ]

    it.each(READS)('GET %s -> 200', async (route) => {
        const res = await request(app).get(route).set(authHeader(user.token))

        expect(res.status).toBe(200)
    })

    it('the pre-expiry data is all still there and blocked writes add nothing', async () => {
        const blocked = await createExpenseViaApi(app, user.token, accountId, categoryId, { title: 'After expiry' })
        expect(blocked.status).toBe(402)

        const list = await request(app).get('/api/v1/transactions').set(authHeader(user.token))
        expect(list.status).toBe(200)
        expect(JSON.stringify(list.body)).toContain('Lunch')
        expect(JSON.stringify(list.body)).not.toContain('After expiry')
        expect(await Transaction.countDocuments({ userId: user.userId })).toBe(1)
        expect(await Account.countDocuments({ userId: user.userId })).toBe(1)
    })

    it('reactivation restores write access to the same data with no re-onboarding', async () => {
        await setSubscription(user.userId, BILLING_STATES.active)

        const res = await createExpenseViaApi(app, user.token, accountId, categoryId, { title: 'Back again' })

        expect(res.status).toBe(201)
        expect(await Transaction.countDocuments({ userId: user.userId })).toBe(2)
    })
})

describe('writable states are not gated', () => {
    let user: RegisteredUser

    beforeEach(async () => {
        enableBilling()
        await seedTestPlans()
        user = await registerUser(app)
        await setSubscription(user.userId, BILLING_STATES.active)
    })

    it.each(GATED.map((r) => [label(r), r] as const))('%s is not 402 for an active Pro user', async (_name, route) => {
        const res = await send(user.token, route)

        expect(res.status).not.toBe(402)
    })

    it.each(['trialing', 'past_due_in_grace'])('POST /accounts succeeds while %s', async (state) => {
        await setSubscription(user.userId, BILLING_STATES[state])

        const res = await request(app).post('/api/v1/accounts').set(authHeader(user.token)).send({
            name: 'Fine',
            type: 'checking',
            openingBalance: 1,
        })

        expect(res.status).toBe(201)
    })
})

describe('route classification drift guard', () => {
    const modulesDir = path.resolve(__dirname, '..', '..', 'src', 'modules')

    const countMutatingRegistrations = (): number => {
        let total = 0
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full)
                } else if (entry.name.endsWith('.routes.ts')) {
                    total += (fs.readFileSync(full, 'utf8').match(/router\.(post|put|patch|delete)\(/g) ?? []).length
                }
            }
        }
        walk(modulesDir)
        return total
    }

    it('every mutating route registered under src/modules is classified in this file', () => {
        const classified =
            GATED.length + EXEMPT.length + UNAUTHENTICATED.length + WORKSPACE_SCOPED.length

        expect(
            countMutatingRegistrations(),
            'a router.post/put/patch/delete was added or removed - classify it as GATED (write), EXEMPT (deliberately still allowed when read-only), UNAUTHENTICATED or WORKSPACE_SCOPED'
        ).toBe(classified)
    })

    it('no route is classified twice', () => {
        const all = [...GATED, ...EXEMPT, ...UNAUTHENTICATED, ...WORKSPACE_SCOPED].map(
            (r) => `${r.method} ${r.path.replace(/[0-9a-f]{24}/g, ':id')}`
        )

        expect(new Set(all).size).toBe(all.length)
    })
})
