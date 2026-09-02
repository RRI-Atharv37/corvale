import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, seedUserDirectly } from './helpers'
import { toMinorUnits } from '@shared/money'
import { Transaction } from '@modules/transactions'
import { Account } from '@modules/accounts'

/**
 * G2's "load sanity check on the report and backup endpoints" (L12): not a throughput
 * benchmark, just a floor - these endpoints must stay correct and respond inside a generous
 * budget once a user has a realistic volume of data and several requests land concurrently.
 * Catches missing indexes (collection scans) and N+1 request handling before they reach users.
 */

const TRANSACTION_COUNT = 400
const LATENCY_BUDGET_MS = 5000

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

/** Seed one account/category plus a spread of posted transactions directly (bypassing the
 * per-request REST overhead of the create endpoint, since the point here is to exercise the
 * *read* paths under realistic data volume, not to benchmark transaction creation). */
async function seedTransactionVolume(token: string, userId: string, count: number) {
    const accountRes = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 5000 })
    const account = accountRes.body.data

    const foodMasterId = await getFoodMasterId(token)

    const docs = Array.from({ length: count }, (_, i) => ({
        userId,
        accountId: account._id,
        categoryId: foodMasterId,
        type: i % 5 === 0 ? 'income' : ('expense' as const),
        status: 'posted' as const,
        amount: toMinorUnits(10 + (i % 200)),
        currency: 'USD',
        title: `Load test row ${i}`,
        date: new Date(2026, i % 12, (i % 27) + 1),
    }))

    await Transaction.insertMany(docs)

    return { account, foodMasterId }
}

describe('G2 load sanity — reports', () => {
    it('serves report endpoints concurrently against a realistic dataset within budget', async () => {
        const { token, userId } = await seedUserDirectly()
        await seedTransactionVolume(token, userId, TRANSACTION_COUNT)

        const endpoints = [
            '/api/v1/dashboard/reports/averages?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/largest-expenses?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/spending-trends?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/income-vs-expense?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/savings-rate?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/recurring-totals?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/budget-analysis?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/spending-analysis?periodType=yearly&year=2026',
            '/api/v1/dashboard/reports/crossover-point?periodType=yearly&year=2026',
        ]

        const start = Date.now()
        // Fire every endpoint concurrently, twice, to approximate more than one dashboard tab
        // open on the same account at once rather than serializing one request at a time.
        const responses = await Promise.all(
            [...endpoints, ...endpoints].map((path) =>
                request(app).get(path).set(authHeader(token))
            )
        )
        const elapsed = Date.now() - start

        responses.forEach((res) => {
            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
        })
        expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS)
    })
})

describe('G2 load sanity — backup export/restore', () => {
    it('round-trips a realistic-size backup within budget', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'backup-load@example.com' })
        await seedTransactionVolume(token, userId, TRANSACTION_COUNT)

        const exportStart = Date.now()
        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(token))
        const exportElapsed = Date.now() - exportStart

        expect(exportRes.status).toBe(200)
        const backup = JSON.parse(exportRes.text)
        expect(backup.counts.transactions).toBe(TRANSACTION_COUNT)
        expect(exportElapsed).toBeLessThan(LATENCY_BUDGET_MS)

        // Restore into a second, empty user to measure the restore path (id remapping, sequential
        // per-record creates) at the same volume, isolated from the export user's own data.
        const second = await seedUserDirectly({ email: 'backup-load-restore@example.com' })
        const restoreStart = Date.now()
        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(second.token))
            .send({ backup })
        const restoreElapsed = Date.now() - restoreStart

        expect(restoreRes.status).toBe(201)
        expect(restoreRes.body.data.created.transactions).toBe(TRANSACTION_COUNT)
        expect(restoreElapsed).toBeLessThan(LATENCY_BUDGET_MS * 4)

        const restoredCount = await Transaction.countDocuments({ userId: second.userId })
        expect(restoredCount).toBe(TRANSACTION_COUNT)
    })
})

interface QueryPlannerExplain {
    queryPlanner: { winningPlan: unknown }
}

describe('G2 load sanity — index coverage', () => {
    it('report-shaped Transaction queries are index-covered for both personal and workspace scope', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'index-review@example.com' })
        const foodMasterId = await getFoodMasterId(token)
        await Transaction.create({
            userId,
            accountId: (
                await Account.create({ userId, name: 'A', type: 'checking', currency: 'USD' })
            )._id,
            categoryId: foodMasterId,
            type: 'expense',
            status: 'posted',
            amount: 100,
            currency: 'USD',
            title: 'x',
            date: new Date(),
        })

        const personalPlan = (await Transaction.find({
            userId,
            type: 'expense',
            date: { $gte: new Date(2026, 0, 1), $lte: new Date(2026, 11, 31) },
        }).explain('queryPlanner')) as unknown as QueryPlannerExplain
        expect(JSON.stringify(personalPlan.queryPlanner.winningPlan)).not.toMatch(/COLLSCAN/)

        const workspacePlan = (await Transaction.find({
            workspaceId: userId,
            type: 'expense',
            date: { $gte: new Date(2026, 0, 1), $lte: new Date(2026, 11, 31) },
        }).explain('queryPlanner')) as unknown as QueryPlannerExplain
        expect(JSON.stringify(workspacePlan.queryPlanner.winningPlan)).not.toMatch(/COLLSCAN/)
    })
})
