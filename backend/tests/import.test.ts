import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
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

function parseFile(token: string, content: string, filename: string) {
    return request(app)
        .post('/api/v1/imports/parse')
        .set(authHeader(token))
        .attach('file', Buffer.from(content, 'utf-8'), filename)
}

function previewImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/preview').set(authHeader(token)).send(payload)
}

function commitImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/commit').set(authHeader(token)).send(payload)
}

const GENERIC_CSV = ['Date,Description,Amount', '2026-01-05,Grocery Store,-45.50', '2026-01-06,Paycheck,2000'].join(
    '\n'
)

const CHASE_CSV = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '01/05/2026,01/06/2026,Grocery Store,Groceries,Sale,-45.50,',
    '01/06/2026,01/07/2026,Employer Payroll,,Payment,2000.00,',
].join('\n')

const CORVALE_EXPORT_CSV = [
    'Type,Title,Amount,Currency,Category,Date,Description,Source,Payment Method,Tags,Status',
    'expense,Grocery Store,45.50,USD,Food,2026-01-05,Weekly shop,manual,card,groceries,posted',
].join('\n')

describe('Bank CSV/OFX import - parse & format detection', () => {
    it('detects a generic CSV format and suggests a column mapping', async () => {
        const { token } = await seedUserDirectly({ email: 'import-generic@example.com' })

        const res = await parseFile(token, GENERIC_CSV, 'transactions.csv')

        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('generic')
        expect(res.body.data.requiresMapping).toBe(true)
        expect(res.body.data.totalRows).toBe(2)
        expect(res.body.data.suggestedMapping.date).toBe('Date')
        expect(res.body.data.suggestedMapping.amount).toBe('Amount')
        expect(res.body.data.suggestedMapping.description).toBe('Description')
    })

    it('detects a Chase-style CSV format', async () => {
        const { token } = await seedUserDirectly({ email: 'import-chase@example.com' })

        const res = await parseFile(token, CHASE_CSV, 'chase.csv')

        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('chase')
        expect(res.body.data.suggestedMapping.date).toBe('Transaction Date')
        expect(res.body.data.suggestedMapping.description).toBe('Description')
        expect(res.body.data.suggestedMapping.amount).toBe('Amount')
    })

    it('detects a corvale_export CSV format matching the export column order', async () => {
        const { token } = await seedUserDirectly({ email: 'import-corvale@example.com' })

        const res = await parseFile(token, CORVALE_EXPORT_CSV, 'corvale-export.csv')

        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('corvale_export')
    })

    it('parses OFX content directly without requiring a column mapping', async () => {
        const { token } = await seedUserDirectly({ email: 'import-ofx@example.com' })
        const ofx = [
            'OFXHEADER:100',
            '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>',
            '<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-45.50<DTPOSTED>20260105120000<NAME>Grocery Store</STMTTRN>',
            '<STMTTRN><TRNTYPE>CREDIT<TRNAMT>2000.00<DTPOSTED>20260106120000<NAME>Employer Payroll</STMTTRN>',
            '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
        ].join('\n')

        const res = await parseFile(token, ofx, 'transactions.ofx')

        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('ofx')
        expect(res.body.data.requiresMapping).toBe(false)
        expect(res.body.data.parsedRows).toHaveLength(2)
        expect(res.body.data.parsedRows[0].type).toBe('expense')
        expect(res.body.data.parsedRows[1].type).toBe('income')
    })

    it('rejects an empty file', async () => {
        const { token } = await seedUserDirectly({ email: 'import-empty@example.com' })

        const res = await parseFile(token, '   ', 'empty.csv')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/empty/i)
    })

    it('rejects a CSV with a blank header row', async () => {
        const { token } = await seedUserDirectly({ email: 'import-missing-headers@example.com' })

        const res = await parseFile(token, ',,,\n1,2,3,4', 'bad-headers.csv')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/header/i)
    })

    it('rejects a disallowed file type', async () => {
        const { token } = await seedUserDirectly({ email: 'import-bad-type@example.com' })

        const res = await request(app)
            .post('/api/v1/imports/parse')
            .set(authHeader(token))
            .attach('file', Buffer.from('not a csv'), 'malware.exe')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/must be a csv/i)
    })

    it('rejects a CSV exceeding the 2,000 row limit', async () => {
        const { token } = await seedUserDirectly({ email: 'import-too-many-rows@example.com' })
        const rows = Array.from({ length: 2001 }, (_, i) => `2026-01-01,Row ${i},-1.00`)
        const content = ['Date,Description,Amount', ...rows].join('\n')

        const res = await parseFile(token, content, 'huge.csv')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/2,000 row limit/i)
    })
})

describe('Bank CSV import - column mapping & preview', () => {
    it('maps debit/credit columns into expense/income rows', async () => {
        const { token } = await seedUserDirectly({ email: 'import-debit-credit@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Debit', 'Credit'],
            rows: [
                ['2026-01-05', 'Grocery Store', '45.50', ''],
                ['2026-01-06', 'Paycheck', '', '2000.00'],
            ],
            mapping: { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items).toHaveLength(2)
        expect(res.body.data.items[0].type).toBe('expense')
        expect(res.body.data.items[0].amount).toBe(45.5)
        expect(res.body.data.items[1].type).toBe('income')
        expect(res.body.data.items[1].amount).toBe(2000)
        expect(res.body.data.summary.valid).toBe(2)
    })

    it('infers income/expense from a signed amount column', async () => {
        const { token } = await seedUserDirectly({ email: 'import-signed-amount@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-05', 'Grocery Store', '-45.50']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].type).toBe('expense')
        expect(res.body.data.items[0].amount).toBe(45.5)
    })

    it('rejects a mapping missing the required date column', async () => {
        const { token } = await seedUserDirectly({ email: 'import-no-date-mapping@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Description', 'Amount'],
            rows: [['Grocery Store', '-45.50']],
            mapping: { description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/date column/i)
    })

    it('surfaces row-level errors for invalid dates and amounts without failing the whole preview', async () => {
        const { token } = await seedUserDirectly({ email: 'import-row-errors@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Debit', 'Credit'],
            rows: [
                ['not-a-date', 'Bad Row', '10.00', ''],
                ['2026-01-05', 'Both Set', '10.00', '5.00'],
                ['2026-01-06', 'Good Row', '12.00', ''],
            ],
            mapping: { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.summary.total).toBe(3)
        expect(res.body.data.summary.valid).toBe(1)
        expect(res.body.data.summary.invalid).toBe(2)
        const errored = res.body.data.items.filter((item: { error?: string }) => item.error)
        expect(errored).toHaveLength(2)
    })

    it('applies matching categorization rules to preview rows', async () => {
        const { token } = await seedUserDirectly({ email: 'import-rules@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await request(app)
            .post('/api/v1/categorization-rules')
            .set(authHeader(token))
            .send({
                name: 'Grocery rule',
                matchType: 'description_contains',
                matchValue: 'grocery',
                categoryId,
                tags: ['groceries'],
            })

        const res = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-05', 'Grocery Store run', '-45.50']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].appliedRuleName).toBe('Grocery rule')
        expect(res.body.data.items[0].tags).toEqual(['groceries'])
    })
})

describe('Bank CSV import - commit', () => {
    it('creates transactions and updates the account balance', async () => {
        const { token } = await seedUserDirectly({ email: 'import-commit@example.com' })
        const account = await createTestAccount(token, 1000)
        const categoryId = await getFoodMasterId(token)

        const res = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [
                ['2026-01-05', 'Grocery Store', '-45.50'],
                ['2026-01-06', 'Paycheck', '2000'],
            ],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(2)
        expect(res.body.data.transactionIds).toHaveLength(2)

        const created = await Transaction.find({ userId: (await Account.findById(account._id))?.userId })
        expect(created).toHaveLength(2)

        const updatedAccount = await Account.findById(account._id)
        expect(updatedAccount?.currentBalance).toBe(1000 - 45.5 + 2000)
    })

    it('rejects commit when no rows are valid', async () => {
        const { token } = await seedUserDirectly({ email: 'import-no-valid-rows@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['bad-date', 'Bad Row', '10.00']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/no valid rows/i)
    })

    it('returns 403 when the account belongs to another user', async () => {
        const owner = await seedUserDirectly({ email: 'import-owner@example.com' })
        const other = await createSecondUser(app)
        const account = await createTestAccount(owner.token)
        const categoryId = await getFoodMasterId(other.token)

        const res = await commitImport(other.token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-05', 'Grocery Store', '-45.50']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(403)
    })

    it('requires accountId and defaultCategoryId', async () => {
        const { token } = await seedUserDirectly({ email: 'import-missing-fields@example.com' })

        const res = await commitImport(token, {
            headers: ['Date', 'Description', 'Amount'],
            rows: [['2026-01-05', 'Grocery Store', '-45.50']],
            mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
        })

        expect(res.status).toBe(400)
    })
})
