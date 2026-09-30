import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { CategorizationRule } from '@modules/categorization-rules'
import { Category } from '@modules/categories'
import { Receipt } from '@modules/receipts'
import { Tag } from '@modules/tags'
import { Transaction } from '@modules/transactions'
import { TransactionTemplate } from '@modules/transaction-templates'
import { RECEIPT_UPLOAD_ROOT, getUserReceiptStorageUsageBytes } from '@modules/receipts/receiptUtils'
import { authHeader, registerUser, seedUserDirectly } from '@tests/helpers'

/**
 * S49 / BUG-61: an ordinary export must restore without a 400, link transfer pairs and splits,
 * drop receipt ids whose files were not restored, and a restore that fails must leave nothing
 * behind. The preview must report the same reference errors the restore would raise.
 */

const FIXTURE_PNG = path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'sample-receipt.png')
const PNG_BYTES = fs.readFileSync(FIXTURE_PNG)
const HTML_BYTES = Buffer.from('<html><body>not a receipt</body></html>')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZip = require('adm-zip') as new () => {
    addFile: (entryName: string, data: Buffer) => void
    toBuffer: () => Buffer
}

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
})

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

const getMasterId = async (token: string, name: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const master = res.body.data.masters.find((m: { name: string }) => m.name === name)
    if (!master) throw new Error(`${name} master category not found`)
    return master._id
}

const createAccount = async (token: string, name: string, openingBalance: number) => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

const seedLedger = async (token: string) => {
    const checking = await createAccount(token, 'Checking', 1000)
    const savings = await createAccount(token, 'Savings', 500)
    const foodId = await getMasterId(token, 'Food')

    const expense = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Groceries',
            amount: 42,
            date: '2026-01-15T12:00:00.000Z',
            accountId: checking._id,
            categoryId: foodId,
        })

    const upload = await request(app)
        .post('/api/v1/receipts')
        .set(authHeader(token))
        .attach('receipt', FIXTURE_PNG)
    expect(upload.status).toBe(201)
    const attach = await request(app)
        .post(`/api/v1/transactions/${expense.body.data._id}/receipts`)
        .set(authHeader(token))
        .send({ receiptId: upload.body.data._id })
    expect(attach.status).toBe(200)

    await request(app)
        .post('/api/v1/transactions/transfer')
        .set(authHeader(token))
        .send({
            title: 'Move to savings',
            amount: 100,
            date: '2026-01-16T12:00:00.000Z',
            fromAccountId: checking._id,
            toAccountId: savings._id,
        })

    await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Mixed shopping trip',
            amount: 100,
            date: '2026-01-17T12:00:00.000Z',
            accountId: checking._id,
            splits: [
                { categoryId: foodId, amount: 60 },
                { categoryId: await getMasterId(token, 'Shopping'), amount: 40 },
            ],
        })

    return { checking, savings, foodId }
}

const shapeOf = async (userId: string): Promise<string[]> => {
    const rows = await Transaction.find({ userId }).lean()
    return rows.map((row) => `${row.title}|${row.type}|${row.amount}|${row.date.toISOString()}`).sort()
}

const countUserRows = async (userId: string) => ({
    accounts: await Account.countDocuments({ userId }),
    categories: await Category.countDocuments({ userId }),
    tags: await Tag.countDocuments({ userId }),
    transactions: await Transaction.countDocuments({ userId }),
    receipts: await Receipt.countDocuments({ userId }),
})

const NOTHING = { accounts: 0, categories: 0, tags: 0, transactions: 0, receipts: 0 }

describe('Backup restore round trip - receipts, transfers and splits (BUG-61)', () => {
    it('restores a JSON export with a receipt-bearing transaction, a transfer and a split into a fresh account', async () => {
        const source = await registerUser(app, { email: 'bug61-source@example.com' })
        const target = await seedUserDirectly({ email: 'bug61-target@example.com' })
        await seedLedger(source.token)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        expect(exportRes.body.receipts).toHaveLength(1)

        const previewRes = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(target.token))
            .send({ backup: exportRes.body })
        expect(previewRes.status).toBe(200)
        expect(previewRes.body.data.valid).toBe(true)

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: exportRes.body })

        expect(restoreRes.status).toBe(201)
        expect(restoreRes.body.data.created.transactions).toBe(exportRes.body.transactions.length)

        expect(await shapeOf(target.userId)).toEqual(await shapeOf(source.userId))

        const restored = await Transaction.find({ userId: target.userId }).lean()
        const byId = new Map(restored.map((row) => [row._id.toString(), row]))

        const legs = restored.filter((row) => row.type === 'transfer')
        expect(legs).toHaveLength(2)
        for (const leg of legs) {
            const pair = byId.get(String(leg.transferPairId))
            expect(pair).toBeDefined()
            expect(String(pair?.transferPairId)).toBe(leg._id.toString())
        }

        const parent = restored.find((row) => row.title === 'Mixed shopping trip' && !row.splitTransactionId)
        const children = restored.filter((row) => String(row.splitTransactionId) === String(parent?._id))
        expect(children).toHaveLength(2)
        expect(children.reduce((sum, child) => sum + child.amount, 0)).toBe(parent?.amount)

        const groceries = restored.find((row) => row.title === 'Groceries')
        expect(groceries?.receiptIds ?? []).toHaveLength(0)
        expect(await Receipt.countDocuments({ userId: target.userId })).toBe(0)
    })

    it('drops receipt ids that reference receipts absent from the backup', async () => {
        const source = await seedUserDirectly({ email: 'bug61-dangling-source@example.com' })
        const target = await seedUserDirectly({ email: 'bug61-dangling-target@example.com' })
        const account = await createAccount(source.token, 'Checking', 100)
        const foodId = await getMasterId(source.token, 'Food')
        await Transaction.create({
            userId: source.userId,
            accountId: account._id,
            categoryId: foodId,
            type: 'expense',
            status: 'posted',
            amount: 500,
            currency: 'USD',
            title: 'Dangling receipt',
            date: new Date('2026-01-15T00:00:00.000Z'),
            receiptIds: [new Types.ObjectId()],
        })

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: exportRes.body })

        expect(restoreRes.status).toBe(201)
        const restored = await Transaction.findOne({ userId: target.userId, title: 'Dangling receipt' })
        expect(restored?.receiptIds ?? []).toHaveLength(0)
    })

    it('restores a ZIP export and re-links the receipt that came back with it', async () => {
        const source = await registerUser(app, { email: 'bug61-zip-source@example.com' })
        const target = await seedUserDirectly({ email: 'bug61-zip-target@example.com' })
        await seedLedger(source.token)

        const zipRes = await request(app)
            .get('/api/v1/backup/export')
            .query({ format: 'zip' })
            .set(authHeader(source.token))
            .buffer(true)
            .parse((response, callback) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk: Buffer) => chunks.push(chunk))
                response.on('end', () => callback(null, Buffer.concat(chunks)))
            })

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .attach('file', zipRes.body as Buffer, 'backup.zip')

        expect(restoreRes.status).toBe(201)
        const receipts = await Receipt.find({ userId: target.userId })
        expect(receipts).toHaveLength(1)
        const groceries = await Transaction.findOne({ userId: target.userId, title: 'Groceries' })
        expect(groceries?.receiptIds?.map(String)).toEqual([receipts[0]._id.toString()])
    })
})

describe('Backup restore - failure leaves nothing behind (BUG-61)', () => {
    it('writes nothing when a transaction carries a broken category reference', async () => {
        const target = await seedUserDirectly({ email: 'bug61-broken-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const payload = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            tags: [{ id: 't1', name: 'Essential', color: '#00FF00' }],
            accounts: [{ id: 'a1', name: 'Checking', type: 'checking', currency: 'USD', openingBalance: 10 }],
            transactions: [
                {
                    id: 'x1',
                    accountId: 'a1',
                    categoryId: 'missing-category',
                    type: 'expense',
                    amount: 100,
                    currency: 'USD',
                    title: 'Orphan',
                    date: '2026-01-15T00:00:00.000Z',
                },
            ],
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/broken reference/i)
        expect(await countUserRows(target.userId)).toEqual(NOTHING)
    })

    it('writes nothing and answers 400 when a record fails schema validation', async () => {
        const target = await seedUserDirectly({ email: 'bug61-invalid-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const payload = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            tags: [{ id: 't1', name: 'Essential', color: '#00FF00' }],
            accounts: [{ id: 'a1', name: 'Bad type', type: 'not-an-account-type', currency: 'USD' }],
        })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(400)
        expect(await countUserRows(target.userId)).toEqual(NOTHING)
    })

    it('writes nothing when a ZIP receipt file is rejected', async () => {
        const target = await seedUserDirectly({ email: 'bug61-zipfail-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const payload = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            accounts: [{ id: 'a1', name: 'Checking', type: 'checking', currency: 'USD', openingBalance: 10 }],
            receipts: [
                {
                    id: 'r1',
                    originalFilename: 'receipt.png',
                    storedFilename: 'stored-1.png',
                    mimeType: 'image/png',
                    size: 10,
                },
            ],
        })
        const zip = new AdmZip()
        zip.addFile('corvale-backup.json', Buffer.from(JSON.stringify(payload)))
        zip.addFile('receipts/stored-1.png', HTML_BYTES)

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .attach('file', zip.toBuffer(), 'backup.zip')

        expect(res.status).toBe(400)
        expect(await countUserRows(target.userId)).toEqual(NOTHING)
    })

    it('rolls back rows, receipt files and receipt quota when a later write fails', async () => {
        const target = await seedUserDirectly({ email: 'bug61-rollback-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const payload = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            tags: [{ id: 't1', name: 'Essential', color: '#00FF00' }],
            accounts: [{ id: 'a1', name: 'Checking', type: 'checking', currency: 'USD', openingBalance: 10 }],
            transactions: [
                {
                    id: 'x1',
                    accountId: 'a1',
                    categoryId: 'c1',
                    type: 'expense',
                    amount: 100,
                    currency: 'USD',
                    title: 'Lunch',
                    date: '2026-01-15T00:00:00.000Z',
                    receiptIds: ['r1'],
                },
            ],
            receipts: [
                {
                    id: 'r1',
                    originalFilename: 'receipt.png',
                    storedFilename: 'stored-1.png',
                    mimeType: 'image/png',
                    size: PNG_BYTES.byteLength,
                },
            ],
        })
        const zip = new AdmZip()
        zip.addFile('corvale-backup.json', Buffer.from(JSON.stringify(payload)))
        zip.addFile('receipts/stored-1.png', PNG_BYTES)

        vi.spyOn(Transaction, 'insertMany').mockRejectedValueOnce(new Error('disk full'))

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .attach('file', zip.toBuffer(), 'backup.zip')

        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(await countUserRows(target.userId)).toEqual(NOTHING)

        const userDir = path.join(RECEIPT_UPLOAD_ROOT, target.userId)
        expect(fs.existsSync(userDir) ? fs.readdirSync(userDir) : []).toHaveLength(0)
        expect(await getUserReceiptStorageUsageBytes(target.userId)).toBe(0)
    })

    it('does not accumulate rows when a failed restore is retried, then a valid one succeeds', async () => {
        const target = await seedUserDirectly({ email: 'bug61-retry-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')
        const broken = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            accounts: [{ id: 'a1', name: 'Bad type', type: 'nope', currency: 'USD' }],
        })

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const res = await request(app)
                .post('/api/v1/backup/restore')
                .set(authHeader(target.token))
                .send({ backup: broken })
            expect(res.status).toBe(400)
        }
        expect(await countUserRows(target.userId)).toEqual(NOTHING)

        const valid = buildPayload({
            categories: [{ id: 'c1', name: 'Takeout', masterCategoryId: foodId }],
            accounts: [{ id: 'a1', name: 'Checking', type: 'checking', currency: 'USD', openingBalance: 10 }],
        })
        const ok = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: valid })
        expect(ok.status).toBe(201)
        expect(await countUserRows(target.userId)).toEqual({ ...NOTHING, accounts: 1, categories: 1 })
    })
})

describe('Backup preview reports what the restore would reject (BUG-61)', () => {
    it('marks a backup with a broken reference as invalid and lists the error', async () => {
        const target = await seedUserDirectly({ email: 'bug61-preview-target@example.com' })
        const payload = buildPayload({
            accounts: [{ id: 'a1', name: 'Checking', type: 'checking', currency: 'USD' }],
            transactions: [
                {
                    id: 'x1',
                    accountId: 'a1',
                    categoryId: 'missing-category',
                    type: 'expense',
                    amount: 100,
                    currency: 'USD',
                    title: 'Orphan',
                    date: '2026-01-15T00:00:00.000Z',
                },
            ],
        })

        const res = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(200)
        expect(res.body.data.valid).toBe(false)
        expect(res.body.data.errors.join(' ')).toMatch(/broken reference/i)
        expect(await countUserRows(target.userId)).toEqual(NOTHING)
    })
})

describe('Workspace backup - co-member data (BUG-61)', () => {
    const seedWorkspaceWithCoMemberData = async () => {
        const owner = await seedUserDirectly({ email: 'bug61-ws-owner@example.com' })
        const editor = await seedUserDirectly({ email: 'bug61-ws-editor@example.com' })

        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Household' })
        const workspaceId = workspaceRes.body.data._id as string

        const invite = await request(app)
            .post(`/api/v1/workspaces/${workspaceId}/members`)
            .set(authHeader(owner.token))
            .send({ email: editor.email, role: 'editor' })
        await request(app)
            .post(`/api/v1/workspaces/invites/${invite.body.data._id}/accept`)
            .set(authHeader(editor.token))

        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared Checking', type: 'checking', openingBalance: 1000, workspaceId })
        const accountId = accountRes.body.data._id as string

        const foodId = await getMasterId(owner.token, 'Food')
        const editorCategory = await Category.create({
            userId: editor.userId,
            masterCategoryId: foodId,
            name: 'Editor private category',
        })
        const editorReceipt = await Receipt.create({
            userId: editor.userId,
            originalFilename: 'editor.png',
            storedFilename: 'editor-stored.png',
            mimeType: 'image/png',
            size: 10,
        })
        await Transaction.create({
            userId: editor.userId,
            workspaceId,
            accountId,
            categoryId: editorCategory._id,
            type: 'expense',
            status: 'posted',
            amount: 1234,
            currency: 'USD',
            title: 'Co-member purchase',
            date: new Date('2026-01-15T00:00:00.000Z'),
            receiptIds: [editorReceipt._id],
        })

        return { owner, editor, workspaceId }
    }

    it('exports the co-member category the shared transaction uses, without the co-member identity', async () => {
        const { owner, editor, workspaceId } = await seedWorkspaceWithCoMemberData()

        const res = await request(app)
            .get('/api/v1/backup/export')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        expect(res.status).toBe(200)
        const category = res.body.categories.find(
            (row: { name: string }) => row.name === 'Editor private category'
        )
        expect(category).toBeDefined()
        expect(category.userId).toBeUndefined()
        expect(JSON.stringify(category)).not.toContain(editor.userId)
    })

    it('restores the workspace backup into personal data as the exporting member', async () => {
        const { owner, workspaceId } = await seedWorkspaceWithCoMemberData()

        const exportRes = await request(app)
            .get('/api/v1/backup/export')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(owner.token))
            .send({ backup: exportRes.body })

        expect(restoreRes.status).toBe(201)

        const restored = await Transaction.findOne({ userId: owner.userId, title: 'Co-member purchase' })
        expect(restored).not.toBeNull()
        expect(restored?.receiptIds ?? []).toHaveLength(0)

        const category = await Category.findOne({ userId: owner.userId, name: 'Editor private category' })
        expect(category).not.toBeNull()
        expect(String(restored?.categoryId)).toBe(category?._id.toString())
    })
})

describe('Backup restore - categories missing from an older workspace backup', () => {
    const MISSING_CATEGORY_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'

    const olderWorkspacePayload = (foodId: string, categoryId: string) =>
        buildPayload({
            categories: [{ id: foodId, name: 'Food' }],
            accounts: [{ id: 'a1', name: 'Shared', type: 'checking', currency: 'USD', openingBalance: 10 }],
            transactions: [
                {
                    id: 'x1',
                    accountId: 'a1',
                    categoryId,
                    type: 'expense',
                    amount: 100,
                    currency: 'USD',
                    title: 'Co-member purchase',
                    date: '2026-01-15T00:00:00.000Z',
                },
            ],
        })

    it('files the transaction under Other and says so in the preview and the result', async () => {
        const target = await seedUserDirectly({ email: 'bug61-other-target@example.com' })
        const foodId = await getMasterId(target.token, 'Food')
        const otherId = await getMasterId(target.token, 'Other')
        const payload = olderWorkspacePayload(foodId, MISSING_CATEGORY_ID)

        const preview = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(target.token))
            .send({ backup: payload })
        expect(preview.body.data.valid).toBe(true)
        expect(preview.body.data.warnings.join(' ')).toMatch(/filed under Other/)

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: payload })

        expect(res.status).toBe(201)
        expect(res.body.data.warnings.join(' ')).toMatch(/filed under Other/)
        const restored = await Transaction.findOne({ userId: target.userId, title: 'Co-member purchase' })
        expect(String(restored?.categoryId)).toBe(otherId)
    })

    it('still rejects a category id that is not shaped like a real one', async () => {
        const target = await seedUserDirectly({ email: 'bug61-other-garbage@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: olderWorkspacePayload(foodId, 'not-a-real-id') })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/broken reference/i)
    })
})

describe('Backup export - rules and templates follow the export scope (BUG-61)', () => {
    it('keeps a template on a workspace account out of the personal backup and in the workspace one, and both restore', async () => {
        const owner = await seedUserDirectly({ email: 'bug61-scope-owner@example.com' })
        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Scoped' })
        const workspaceId = workspaceRes.body.data._id as string

        const personal = await createAccount(owner.token, 'Personal', 100)
        const workspaceAccountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared', type: 'checking', openingBalance: 100, workspaceId })
        const workspaceAccountId = workspaceAccountRes.body.data._id as string
        const foodId = await getMasterId(owner.token, 'Food')

        await TransactionTemplate.create({
            userId: owner.userId,
            name: 'Shared coffee',
            type: 'expense',
            amount: 500,
            accountId: workspaceAccountId,
            categoryId: foodId,
        })
        await TransactionTemplate.create({
            userId: owner.userId,
            name: 'Personal coffee',
            type: 'expense',
            amount: 500,
            accountId: personal._id,
            categoryId: foodId,
        })
        await CategorizationRule.create({
            userId: owner.userId,
            name: 'Personal-only rule',
            matchType: 'description_contains',
            matchValue: 'coffee',
            accountId: personal._id,
            categoryId: foodId,
        })
        await CategorizationRule.create({
            userId: owner.userId,
            name: 'Any account rule',
            matchType: 'description_contains',
            matchValue: 'tea',
            categoryId: foodId,
        })

        const personalExport = await request(app).get('/api/v1/backup/export').set(authHeader(owner.token))
        const workspaceExport = await request(app)
            .get('/api/v1/backup/export')
            .query({ workspaceId })
            .set(authHeader(owner.token))

        const names = (rows: { name: string }[]) => rows.map((row) => row.name).sort()
        expect(names(personalExport.body.transactionTemplates)).toEqual(['Personal coffee'])
        expect(names(workspaceExport.body.transactionTemplates)).toEqual(['Shared coffee'])
        expect(names(personalExport.body.categorizationRules)).toEqual(['Any account rule', 'Personal-only rule'])
        expect(names(workspaceExport.body.categorizationRules)).toEqual(['Any account rule'])

        const target = await seedUserDirectly({ email: 'bug61-scope-target@example.com' })
        for (const body of [personalExport.body, workspaceExport.body]) {
            const res = await request(app)
                .post('/api/v1/backup/restore')
                .set(authHeader(target.token))
                .send({ backup: body })
            expect(res.status).toBe(201)
        }
    })
})

describe('Backup restore - transfer direction (BUG-67 interim)', () => {
    it('recomputes the same balances after a restore, even when the file carries no creation times', async () => {
        const source = await seedUserDirectly({ email: 'bug67-source@example.com' })
        const target = await seedUserDirectly({ email: 'bug67-target@example.com' })
        const checking = await createAccount(source.token, 'Checking', 1000)
        const savings = await createAccount(source.token, 'Savings', 500)
        for (let i = 0; i < 3; i += 1) {
            await request(app)
                .post('/api/v1/transactions/transfer')
                .set(authHeader(source.token))
                .send({
                    title: `Move ${i}`,
                    amount: 10,
                    date: '2026-01-16T12:00:00.000Z',
                    fromAccountId: checking._id,
                    toAccountId: savings._id,
                })
        }

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const stripped = {
            ...exportRes.body,
            transactions: exportRes.body.transactions.map(
                ({ createdAt: _createdAt, ...rest }: Record<string, unknown>) => rest
            ),
        }

        const restoreRes = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(target.token))
            .send({ backup: stripped })
        expect(restoreRes.status).toBe(201)

        const restoredSavings = await Account.findOne({ userId: target.userId, name: 'Savings' })
        const recompute = await request(app)
            .post(`/api/v1/accounts/${restoredSavings?._id.toString()}/recompute-balance`)
            .set(authHeader(target.token))
        expect(recompute.status).toBe(200)
        expect(recompute.body.data.recomputedBalance).toBeCloseTo(530, 2)

        const restoredChecking = await Account.findOne({ userId: target.userId, name: 'Checking' })
        const recomputeChecking = await request(app)
            .post(`/api/v1/accounts/${restoredChecking?._id.toString()}/recompute-balance`)
            .set(authHeader(target.token))
        expect(recomputeChecking.body.data.recomputedBalance).toBeCloseTo(970, 2)
    })
})
