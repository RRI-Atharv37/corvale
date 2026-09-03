import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { Transaction } from '@modules/transactions'
import { authHeader, registerUser, seedUserDirectly } from '@tests/helpers'

/**
 * Acceptance spec for S32 — SEC-50 / SEC-51 (`backend/utils/backupUtils.ts`).
 *
 * SEC-50 (High) — the `.zip` restore branch enforced no JSON size cap (only the `.json` branch
 * did), `parseBackupPayload` capped record *shape* but never record *count*, and restore wrote
 * one awaited `Model.create()` per record. A ~2 MB zip sitting under the SEC-16 ratio/size gates
 * could force a 200 MB inflate + `JSON.parse` and ~1.5 M sequential writes in one request.
 *   - `BACKUP_MAX_JSON_BYTES` (env-overridable, 10 MB default) now applies to the extracted
 *     `corvale-backup.json` entry, checked before `JSON.parse`.
 *   - `parseBackupPayload` rejects any section longer than `BACKUP_MAX_RECORDS_PER_COLLECTION`
 *     (env-overridable, 100 000 default).
 *   - transactions + deferred link-ups + savings-goal contributions are written via
 *     `insertMany` / `bulkWrite`, not a per-record loop.
 *
 * SEC-51 (Medium) — the budgets / categorization-rules / transaction-templates loops did
 * `idMap.set(sourceId, sourceId)` (identity mapping), and `mapOptionalId` only guarded on
 * *presence* in the map, not ownership. A crafted backup could declare a budget whose `id` is a
 * victim's account ObjectId, installing an identity mapping a later transaction record resolves
 * as its `accountId` — restore performed no account-ownership validation. Fixed by resolving
 * account / category references through per-kind maps that only ever hold ids created by this
 * restore (or shared master categories), and by storing the created row's id at all three sites.
 */

const emptyCounts = () => ({
    accounts: 0,
    categories: 0,
    tags: 0,
    budgets: 0,
    savingsGoals: 0,
    savingsGoalContributions: 0,
    recurringRules: 0,
    categorizationRules: 0,
    transactionTemplates: 0,
    transactions: 0,
    receipts: 0,
})

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: { workspaceId: null },
    counts: emptyCounts(),
    accounts: [],
    categories: [],
    tags: [],
    budgets: [],
    savingsGoals: [],
    savingsGoalContributions: [],
    recurringRules: [],
    categorizationRules: [],
    transactionTemplates: [],
    transactions: [],
    receipts: [],
    ...overrides,
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new () => {
    addFile: (entryName: string, data: Buffer) => void
    toBuffer: () => Buffer
}

const zipWithJson = (payload: unknown): Buffer => {
    const zip = new AdmZip()
    zip.addFile('corvale-backup.json', Buffer.from(JSON.stringify(payload)))
    return zip.toBuffer()
}

const getFoodMasterId = async (token: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

const accountRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Account ${id}`,
    type: 'checking',
    currency: 'USD',
    openingBalance: 0,
    currentBalance: 0,
    ...overrides,
})

const transactionRecord = (
    id: string,
    accountId: string,
    categoryId: string,
    overrides: Record<string, unknown> = {}
) => ({
    id,
    accountId,
    categoryId,
    type: 'expense',
    status: 'posted',
    amount: 1000,
    currency: 'USD',
    title: `Txn ${id}`,
    date: '2026-01-15T12:00:00.000Z',
    tags: [],
    ...overrides,
})

afterEach(() => {
    delete process.env.BACKUP_MAX_JSON_BYTES
    delete process.env.BACKUP_MAX_RECORDS_PER_COLLECTION
})

describe('SEC-50 — zip JSON size cap', () => {
    it('rejects a zip whose corvale-backup.json entry exceeds BACKUP_MAX_JSON_BYTES before parsing', async () => {
        process.env.BACKUP_MAX_JSON_BYTES = '4096'
        const { token } = await registerUser(app, { email: 'sec50-jsoncap@example.com' })

        const bloated = buildPayload({ _padding: 'x'.repeat(8192) })
        const zip = zipWithJson(bloated)

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'big.zip')

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/size limit|too large|large/i)
    })

    it('still restores a zip whose JSON entry is within the cap', async () => {
        process.env.BACKUP_MAX_JSON_BYTES = '65536'
        const { token } = await registerUser(app, { email: 'sec50-jsonok@example.com' })

        const zip = zipWithJson(buildPayload())

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', zip, 'ok.zip')

        expect(res.status).toBe(201)
    })
})

describe('SEC-50 — per-collection record cap', () => {
    it('rejects a backup whose transactions array is longer than BACKUP_MAX_RECORDS_PER_COLLECTION', async () => {
        process.env.BACKUP_MAX_RECORDS_PER_COLLECTION = '5'
        const { token, userId } = await registerUser(app, { email: 'sec50-recordcap@example.com' })

        const payload = buildPayload({
            transactions: Array.from({ length: 6 }, (_, i) =>
                transactionRecord(`t${i}`, `acc-${i}`, `cat-${i}`)
            ),
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: payload })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/too many|record/i)
        expect(await Transaction.countDocuments({ userId })).toBe(0)
    })

    it('accepts a backup at exactly the cap', async () => {
        process.env.BACKUP_MAX_RECORDS_PER_COLLECTION = '5'
        const { token } = await registerUser(app, { email: 'sec50-atcap@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: buildPayload({ tags: [] }) })

        expect(res.status).toBe(201)
    })
})

describe('SEC-50 — batched restore still links transfers and preserves scope', () => {
    it('restores a multi-transaction backup with a transfer pair via the batched path', async () => {
        const source = await seedUserDirectly({ email: 'sec50-batch-src@example.com' })
        const target = await seedUserDirectly({ email: 'sec50-batch-tgt@example.com' })
        const foodId = await getFoodMasterId(source.token)

        const payload = buildPayload({
            // the master category must be present in the categories array so restore resolves it
            categories: [{ id: foodId, name: 'Food', icon: 'x', color: '#fff' }],
            accounts: [accountRecord('A'), accountRecord('B')],
            transactions: [
                ...Array.from({ length: 10 }, (_, i) =>
                    transactionRecord(`e${i}`, 'A', foodId, { amount: 500 + i })
                ),
                transactionRecord('out', 'A', foodId, {
                    type: 'transfer',
                    amount: 2500,
                    transferPairId: 'in',
                }),
                transactionRecord('in', 'B', foodId, {
                    type: 'transfer',
                    amount: 2500,
                    transferPairId: 'out',
                }),
            ],
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(201)
        expect(res.body.data.created.transactions).toBe(12)

        const targetAccounts = await Account.find({ userId: target.userId })
        expect(targetAccounts).toHaveLength(2)

        const restoredTransfer = await Transaction.findOne({
            userId: target.userId,
            type: 'transfer',
            title: 'Txn out',
        })
        expect(restoredTransfer?.transferPairId).toBeDefined()
        const pair = await Transaction.findById(restoredTransfer?.transferPairId)
        expect(pair?.title).toBe('Txn in')
        expect(pair?.userId.toString()).toBe(target.userId)

        for (const txn of await Transaction.find({ userId: target.userId })) {
            expect(targetAccounts.some((a) => a._id.equals(txn.accountId))).toBe(true)
        }
    })
})

describe('SEC-51 — restore cannot resolve references to a foreign account', () => {
    it('rejects a backup whose budget id is a victim account id used as a transaction accountId', async () => {
        const victim = await seedUserDirectly({ email: 'sec51-victim@example.com' })
        const victimAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(victim.token))
            .send({ name: 'Victim Checking', type: 'checking', openingBalance: 1000 })
        const victimAccountId: string = victimAccountRes.body.data._id

        const attacker = await seedUserDirectly({ email: 'sec51-attacker@example.com' })
        const foodId = await getFoodMasterId(attacker.token)

        const payload = buildPayload({
            categories: [{ id: foodId, name: 'Food', icon: 'x', color: '#fff' }],
            budgets: [
                {
                    id: victimAccountId,
                    name: 'Trojan budget',
                    periodType: 'monthly',
                    periodStart: '2026-01-01T00:00:00.000Z',
                    periodEnd: '2026-01-31T23:59:59.999Z',
                    amount: 100,
                    currency: 'USD',
                    accountIds: [],
                    categoryId: foodId,
                },
            ],
            transactions: [transactionRecord('t1', victimAccountId, foodId)],
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(attacker.token))
            .send({ backup: payload })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/broken reference/i)

        // nothing attached to the victim's account
        expect(
            await Transaction.countDocuments({ accountId: new Types.ObjectId(victimAccountId) })
        ).toBe(0)
    })

    it('stores the created row id (not an identity mapping) for budgets, categorization rules and templates', async () => {
        const source = await seedUserDirectly({ email: 'sec51-idmap-src@example.com' })
        const target = await seedUserDirectly({ email: 'sec51-idmap-tgt@example.com' })
        const foodId = await getFoodMasterId(source.token)

        const payload = buildPayload({
            categories: [{ id: foodId, name: 'Food', icon: 'x', color: '#fff' }],
            accounts: [accountRecord('A')],
            budgets: [
                {
                    id: 'budget-src-1',
                    name: 'Groceries',
                    periodType: 'monthly',
                    periodStart: '2026-01-01T00:00:00.000Z',
                    periodEnd: '2026-01-31T23:59:59.999Z',
                    amount: 300,
                    currency: 'USD',
                    accountIds: ['A'],
                    categoryId: foodId,
                },
            ],
            categorizationRules: [
                {
                    id: 'rule-src-1',
                    name: 'Coffee',
                    matchType: 'description_contains',
                    matchValue: 'coffee',
                    categoryId: foodId,
                    tags: [],
                },
            ],
            transactionTemplates: [
                {
                    id: 'tmpl-src-1',
                    name: 'Coffee run',
                    type: 'expense',
                    amount: 500,
                    accountId: 'A',
                    categoryId: foodId,
                    tags: [],
                },
            ],
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(201)
        const idMapping: Record<string, string> = res.body.data.idMapping

        expect(idMapping['budget-src-1']).toBeDefined()
        expect(idMapping['budget-src-1']).not.toBe('budget-src-1')
        expect(Types.ObjectId.isValid(idMapping['budget-src-1'])).toBe(true)

        const restoredBudget = await Budget.findById(idMapping['budget-src-1'])
        expect(restoredBudget?.userId.toString()).toBe(target.userId)
        // the budget's accountIds resolved to the newly-created target account
        const targetAccount = await Account.findOne({ userId: target.userId, name: 'Account A' })
        expect(restoredBudget?.accountIds.map((a) => a.toString())).toContain(
            targetAccount?._id.toString()
        )

        expect(idMapping['rule-src-1']).not.toBe('rule-src-1')
        expect(idMapping['tmpl-src-1']).not.toBe('tmpl-src-1')
    })
})
