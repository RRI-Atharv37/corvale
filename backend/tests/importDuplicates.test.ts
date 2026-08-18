import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'

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

function previewImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/preview').set(authHeader(token)).send(payload)
}

function commitImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/commit').set(authHeader(token)).send(payload)
}

/**
 * Duplicate fingerprints are built from title + description, and a CSV import row always sets
 * both to the mapped description text. Seed "existing" transactions the same way (via a prior
 * import) so tests exercise the real re-import scenario the duplicate detector targets.
 */
async function seedExistingImportedTransaction(
    token: string,
    accountId: string,
    categoryId: string,
    title: string,
    amount: number,
    isoDate: string
): Promise<string> {
    const res = await commitImport(token, {
        accountId,
        defaultCategoryId: categoryId,
        headers: ['Date', 'Description', 'Amount'],
        rows: [[isoDate, title, String(-amount)]],
        mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    })
    return res.body.data.transactionIds[0]
}

describe('Import duplicate detection', () => {
    it('flags an import row as a duplicate of an existing transaction with matching date/amount/description', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-basic@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const existingId = await seedExistingImportedTransaction(
            token,
            account._id,
            categoryId,
            'Coffee Shop',
            5.25,
            '2026-01-10'
        )

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].duplicateOf).toBeDefined()
        expect(res.body.data.items[0].duplicateOf.transactionId).toBe(existingId)
        expect(res.body.data.items[0].duplicateAction).toBe('skip')
        expect(res.body.data.summary.duplicates).toBe(1)
    })

    it('does not flag two same-day charges with the same amount but different descriptions as duplicates of each other', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-same-day-diff-desc@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await seedExistingImportedTransaction(token, account._id, categoryId, 'Coffee Shop', 5.0, '2026-01-10')

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-10', 'Sandwich Shop', '-5.00']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].duplicateOf).toBeUndefined()
        expect(res.body.data.summary.duplicates).toBe(0)
    })

    it('distinguishes multiple same-day charges to the same merchant by amount', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-same-day-diff-amount@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await seedExistingImportedTransaction(token, account._id, categoryId, 'Coffee Shop', 5.0, '2026-01-10')

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [
                ['2026-01-10', 'Coffee Shop', '-5.00'],
                ['2026-01-10', 'Coffee Shop', '-7.50'],
            ],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].duplicateOf).toBeDefined()
        expect(res.body.data.items[1].duplicateOf).toBeUndefined()
    })

    it('flags repeated identical same-day charges against the same existing transaction', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-repeated-identical@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const existingId = await seedExistingImportedTransaction(
            token,
            account._id,
            categoryId,
            'Vending Machine',
            2.0,
            '2026-01-10'
        )

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [
                ['2026-01-10', 'Vending Machine', '-2.00'],
                ['2026-01-10', 'Vending Machine', '-2.00'],
            ],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].duplicateOf.transactionId).toBe(existingId)
        expect(res.body.data.items[1].duplicateOf.transactionId).toBe(existingId)
        expect(res.body.data.summary.duplicates).toBe(2)
    })

    it('skips duplicate rows on commit by default', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-commit-skip@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await seedExistingImportedTransaction(token, account._id, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

        const res = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [
                ['2026-01-10', 'Coffee Shop', '-5.25'],
                ['2026-01-11', 'Bookstore', '-12.00'],
            ],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(1)
        expect(res.body.data.skipped).toBe(1)

        const total = await Transaction.countDocuments({ accountId: account._id, splitTransactionId: null })
        expect(total).toBe(2)
    })

    it('imports a duplicate row as a new transaction when the row decision is "import"', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-commit-import@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await seedExistingImportedTransaction(token, account._id, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

        const res = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
            rowDecisions: { 1: 'import' },
        })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(1)
        expect(res.body.data.skipped).toBe(0)

        const total = await Transaction.countDocuments({ accountId: account._id, splitTransactionId: null })
        expect(total).toBe(2)
    })

    it('merges a duplicate row into the existing transaction when the row decision is "merge"', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-commit-merge@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const existingId = await seedExistingImportedTransaction(
            token,
            account._id,
            categoryId,
            'Coffee Shop',
            5.25,
            '2026-01-10'
        )

        await request(app)
            .post('/api/v1/categorization-rules')
            .set(authHeader(token))
            .send({
                name: 'Coffee rule',
                matchType: 'description_contains',
                matchValue: 'coffee',
                categoryId,
                tags: ['coffee'],
            })

        const res = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
            rowDecisions: { 1: 'merge' },
        })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(0)
        expect(res.body.data.merged).toBe(1)
        expect(res.body.data.mergedTransactionIds).toEqual([existingId])

        const total = await Transaction.countDocuments({ accountId: account._id, splitTransactionId: null })
        expect(total).toBe(1)

        const merged = await Transaction.findById(existingId)
        expect(merged?.tags).toContain('coffee')
    })

    it('only compares duplicates within the same account', async () => {
        const { token } = await seedUserDirectly({ email: 'dup-cross-account@example.com' })
        const accountA = await createTestAccount(token, 1000, 'Checking A')
        const accountB = await createTestAccount(token, 1000, 'Checking B')
        const categoryId = await getFoodMasterId(token)

        await seedExistingImportedTransaction(token, accountA._id, categoryId, 'Coffee Shop', 5.25, '2026-01-10')

        const res = await previewImport(token, {
            accountId: accountB._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-10', 'Coffee Shop', '-5.25']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].duplicateOf).toBeUndefined()
    })
})
