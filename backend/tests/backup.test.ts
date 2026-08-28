import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import Category from '../models/Category'
import Transaction from '../models/Transaction'
import { authHeader, createSecondUser, seedUserDirectly } from './helpers'

async function createTestAccount(token: string, openingBalance = 1000, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

async function createCustomCategory(token: string, masterCategoryId: string, name: string) {
    const res = await request(app)
        .post('/api/v1/categories')
        .set(authHeader(token))
        .send({ name, masterCategoryId })
    return res.body.data
}

async function createExpense(
    token: string,
    accountId: string,
    categoryId: string,
    title: string,
    amount: number
) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title,
            amount,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId,
        })
}

/** Seed a broad set of Phase 1-9 entities for one user so the export covers every backup section. */
async function seedFullUserData(token: string) {
    const account = await createTestAccount(token, 1000)
    const secondAccount = await createTestAccount(token, 500, 'Savings')
    const foodMasterId = await getFoodMasterId(token)
    const customCategory = await createCustomCategory(token, foodMasterId, 'Takeout')

    const tagRes = await request(app)
        .post('/api/v1/tags')
        .set(authHeader(token))
        .send({ name: 'Essential', color: '#00FF00' })

    await request(app)
        .post('/api/v1/budgets')
        .set(authHeader(token))
        .send({
            periodType: 'monthly',
            year: 2026,
            month: 1,
            amount: 500,
            name: 'January overall',
        })

    await request(app)
        .post('/api/v1/savings-goals')
        .set(authHeader(token))
        .send({ name: 'Emergency fund', targetAmount: 1000 })

    await request(app)
        .post('/api/v1/recurring-rules')
        .set(authHeader(token))
        .send({
            title: 'Electric bill',
            type: 'expense',
            amount: 85,
            accountId: account._id,
            categoryId: customCategory._id,
            interval: 'monthly',
            nextDueDate: '2026-03-01',
        })

    await request(app)
        .post('/api/v1/categorization-rules')
        .set(authHeader(token))
        .send({
            name: 'Takeout rule',
            matchType: 'description_contains',
            matchValue: 'takeout',
            categoryId: customCategory._id,
        })

    await request(app)
        .post('/api/v1/transaction-templates')
        .set(authHeader(token))
        .send({
            name: 'Morning Coffee',
            type: 'expense',
            amount: 5.5,
            accountId: account._id,
            categoryId: customCategory._id,
        })

    const expense = await createExpense(token, account._id, customCategory._id, 'Takeout dinner', 22.5)

    const transferRes = await request(app)
        .post('/api/v1/transactions/transfer')
        .set(authHeader(token))
        .send({
            title: 'Move to savings',
            amount: 100,
            date: '2026-01-16T12:00:00.000Z',
            fromAccountId: account._id,
            toAccountId: secondAccount._id,
        })

    const splitRes = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Mixed shopping trip',
            amount: 100,
            date: '2026-01-17T12:00:00.000Z',
            accountId: account._id,
            splits: [
                { categoryId: foodMasterId, amount: 60 },
                { categoryId: customCategory._id, amount: 40 },
            ],
        })

    return {
        account,
        secondAccount,
        customCategory,
        tagId: tagRes.body.data._id,
        expenseId: expense.body.data._id,
        transferOutboundId: transferRes.body.data.outbound._id,
        transferInboundId: transferRes.body.data.inbound._id,
        splitParentId: splitRes.body.data._id,
    }
}

describe('JSON backup export', () => {
    it('exports all entity types with counts matching the created records', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-export@example.com' })
        await seedFullUserData(token)

        const res = await request(app).get('/api/v1/backup/export').set(authHeader(token))

        expect(res.status).toBe(200)
        const payload = res.body

        expect(payload.version).toBe(1)
        expect(payload.accounts).toHaveLength(2)
        expect(payload.tags).toHaveLength(1)
        expect(payload.budgets).toHaveLength(1)
        expect(payload.savingsGoals).toHaveLength(1)
        expect(payload.recurringRules).toHaveLength(1)
        expect(payload.categorizationRules).toHaveLength(1)
        expect(payload.transactionTemplates).toHaveLength(1)
        // expense + transfer pair (2) + split parent + 2 split children = 6
        expect(payload.transactions).toHaveLength(6)
        expect(payload.categories.some((c: { name: string }) => c.name === 'Takeout')).toBe(true)

        expect(payload.counts.accounts).toBe(payload.accounts.length)
        expect(payload.counts.transactions).toBe(payload.transactions.length)

        for (const account of payload.accounts) {
            expect(account.id).toBeDefined()
            expect(account._id).toBeUndefined()
            expect(account.userId).toBeUndefined()
        }
    })

    it('only exports data scoped to the requesting user', async () => {
        const owner = await seedUserDirectly({ email: 'backup-owner@example.com' })
        const other = await createSecondUser(app)
        await seedFullUserData(owner.token)
        await createTestAccount(other.token, 100, 'Other Checking')

        const res = await request(app).get('/api/v1/backup/export').set(authHeader(other.token))

        expect(res.status).toBe(200)
        expect(res.body.accounts).toHaveLength(1)
        expect(res.body.accounts[0].name).toBe('Other Checking')
    })
})

describe('JSON backup restore - dry run preview', () => {
    it('previews a valid backup without creating any records', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-preview-valid@example.com' })
        await seedFullUserData(token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(token))
        const accountCountBefore = await Account.countDocuments({})
        const transactionCountBefore = await Transaction.countDocuments({})

        const previewRes = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(token))
            .send({ backup: exportRes.body })

        expect(previewRes.status).toBe(200)
        expect(previewRes.body.data.valid).toBe(true)
        expect(previewRes.body.data.errors).toHaveLength(0)
        expect(previewRes.body.data.counts.transactions).toBe(exportRes.body.transactions.length)
        expect(previewRes.body.data.counts.accounts).toBe(exportRes.body.accounts.length)

        expect(await Account.countDocuments({})).toBe(accountCountBefore)
        expect(await Transaction.countDocuments({})).toBe(transactionCountBefore)
    })

    it('rejects previewing a backup with an unsupported version', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-preview-version@example.com' })
        await seedFullUserData(token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(token))
        const badPayload = { ...exportRes.body, version: 99 }

        const previewRes = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(token))
            .send({ backup: badPayload })

        expect(previewRes.status).toBe(400)
        expect(previewRes.body.message).toMatch(/unsupported/i)
    })

    it('rejects a malformed backup payload missing required arrays', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-preview-malformed@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(token))
            .send({ backup: { version: 1, accounts: [] } })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/not a valid corvale backup/i)
    })

    it('requires a backup payload or file', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-preview-missing@example.com' })

        const res = await request(app).post('/api/v1/backup/preview').set(authHeader(token)).send({})

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/required/i)
    })
})

describe('JSON backup restore - commit with id mapping', () => {
    it('restores a full backup into a different user account with remapped ids', async () => {
        const source = await seedUserDirectly({ email: 'backup-restore-source@example.com' })
        const target = await seedUserDirectly({ email: 'backup-restore-target@example.com' })
        const seeded = await seedFullUserData(source.token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: exportRes.body })

        expect(restoreRes.status).toBe(201)
        const result = restoreRes.body.data

        expect(result.created.accounts).toBe(2)
        expect(result.created.transactions).toBe(6)
        expect(result.created.categorizationRules).toBe(1)
        expect(result.created.transactionTemplates).toBe(1)
        expect(result.created.recurringRules).toBe(1)
        expect(result.created.budgets).toBe(1)
        expect(result.created.savingsGoals).toBe(1)

        // ids are remapped: the restored records must not reuse the source ids
        expect(Object.values(result.idMapping)).not.toContain(seeded.account._id)

        const targetAccounts = await Account.find({ userId: target.userId })
        expect(targetAccounts).toHaveLength(2)

        const targetTransactions = await Transaction.find({ userId: target.userId, splitTransactionId: null })
        expect(targetTransactions.length).toBeGreaterThan(0)
        for (const transaction of targetTransactions) {
            // every restored transaction must point at a newly-created target account, not the source one
            expect(targetAccounts.some((a) => a._id.equals(transaction.accountId))).toBe(true)
        }

        const restoredTransfer = await Transaction.findOne({ userId: target.userId, type: 'transfer' })
        expect(restoredTransfer?.transferPairId).toBeDefined()
        const pair = await Transaction.findById(restoredTransfer?.transferPairId)
        expect(pair?.userId.toString()).toBe(target.userId)

        const restoredSplitParent = await Transaction.findOne({
            userId: target.userId,
            title: 'Mixed shopping trip',
        })
        const restoredSplitChildren = await Transaction.find({
            splitTransactionId: restoredSplitParent?._id,
        })
        expect(restoredSplitChildren).toHaveLength(2)
    })

    it('reuses shared master categories instead of duplicating them', async () => {
        const source = await seedUserDirectly({ email: 'backup-restore-master-source@example.com' })
        const target = await seedUserDirectly({ email: 'backup-restore-master-target@example.com' })
        await seedFullUserData(source.token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const masterCountBefore = await Category.countDocuments({ userId: null })

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: exportRes.body })

        expect(restoreRes.status).toBe(201)
        // only the custom "Takeout" category should be newly created for the target user
        expect(restoreRes.body.data.created.categories).toBe(1)
        expect(await Category.countDocuments({ userId: null })).toBe(masterCountBefore)
    })

    it('rejects a backup containing a broken category reference', async () => {
        const source = await seedUserDirectly({ email: 'backup-restore-broken-source@example.com' })
        const target = await seedUserDirectly({ email: 'backup-restore-broken-target@example.com' })
        await seedFullUserData(source.token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const tampered = {
            ...exportRes.body,
            transactions: exportRes.body.transactions.map((t: Record<string, unknown>) => ({
                ...t,
                categoryId: 'not-a-real-id',
            })),
        }

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: tampered })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/broken reference/i)
    })

    it('rejects restore of a backup with an unsupported version', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-restore-version@example.com' })
        await seedFullUserData(token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(token))
        const badPayload = { ...exportRes.body, version: 2 }

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .send({ backup: badPayload })

        expect(res.status).toBe(400)
    })
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new () => {
    addFile: (entryName: string, data: Buffer) => void
    getEntries: () => { entryName: string }[]
    toBuffer: () => Buffer
}

/**
 * V7.3b rename-compat shim: the backup ZIP's JSON entry is renamed from `spndr-backup.json` to
 * `corvale-backup.json`. New exports must use the new name, but `extractBackupFromUpload` must
 * keep reading the legacy name too - otherwise a v1.0.0 build can't restore a backup a tester
 * downloaded before the rename, which is exactly the escape hatch backups exist to provide (see
 * ROADMAP's V7 compat matrix).
 */
describe('Backup ZIP entry name (V7.3b rename shim)', () => {
    it('exports a ZIP whose JSON entry uses the new corvale-backup.json name', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-zip-entry-new@example.com' })

        const res = await request(app)
            .get('/api/v1/backup/export')
            .query({ format: 'zip' })
            .set(authHeader(token))
            .buffer(true)
            .parse((response, callback) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk: Buffer) => chunks.push(chunk))
                response.on('end', () => callback(null, Buffer.concat(chunks)))
            })

        expect(res.status).toBe(200)
        const zip = new AdmZip(res.body as Buffer)
        const entryNames = zip.getEntries().map((entry) => entry.entryName)
        expect(entryNames).toContain('corvale-backup.json')
        expect(entryNames).not.toContain('spndr-backup.json')
    })

    it('still restores a ZIP built with the legacy spndr-backup.json entry name (dual-read)', async () => {
        const { token } = await seedUserDirectly({ email: 'backup-zip-entry-legacy@example.com' })

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(token))

        const legacyZip = new AdmZip()
        legacyZip.addFile('spndr-backup.json', Buffer.from(JSON.stringify(exportRes.body)))

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .attach('file', legacyZip.toBuffer(), 'legacy-backup.zip')

        expect(restoreRes.status).toBe(201)
    })
})
