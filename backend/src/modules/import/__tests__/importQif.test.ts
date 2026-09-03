import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { parseQifContent, isQifContent } from '@shared/csvImport'

async function createTestAccount(token: string, openingBalance = 1000, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

function parseFile(token: string, content: string, filename: string) {
    return request(app)
        .post('/api/v1/imports/parse')
        .set(authHeader(token))
        .attach('file', Buffer.from(content, 'utf-8'), filename)
}

function commitImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/commit').set(authHeader(token)).send(payload)
}

const QIF = [
    '!Type:Bank',
    'D01/05/2026',
    'T-45.50',
    'PGrocery Store',
    'MWeekly shop',
    '^',
    "D1/6'26",
    'T2000.00',
    'PEmployer Payroll',
    '^',
].join('\n')

describe('BUG-23 — QIF parser and QFX detection', () => {
    it('isQifContent recognises a !Type: header', () => {
        expect(isQifContent(QIF)).toBe(true)
        expect(isQifContent('Date,Amount\n2026-01-01,5')).toBe(false)
    })

    it('parseQifContent reads D/T/P/M and both US date shapes', () => {
        const result = parseQifContent(QIF)
        expect(result.errors).toHaveLength(0)
        expect(result.rows).toEqual([
            expect.objectContaining({
                date: '2026-01-05',
                title: 'Grocery Store',
                description: 'Weekly shop',
                amount: 45.5,
                type: 'expense',
            }),
            expect.objectContaining({
                date: '2026-01-06',
                title: 'Employer Payroll',
                amount: 2000,
                type: 'income',
            }),
        ])
    })

    it('a record with no amount becomes a reported error row', () => {
        const result = parseQifContent(['!Type:Bank', 'D01/05/2026', 'PNo amount here', '^'].join('\n'))
        expect(result.rows).toHaveLength(0)
        expect(result.errors[0].message).toMatch(/invalid or zero amount/i)
    })

    it('POST /imports/parse commits a .qif file', async () => {
        const { token } = await seedUserDirectly({ email: 'qif-commit@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const parsed = await parseFile(token, QIF, 'export.qif')
        expect(parsed.status).toBe(200)
        expect(parsed.body.data.format).toBe('qif')
        expect(parsed.body.data.requiresMapping).toBe(false)

        const commit = await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            parsedRows: parsed.body.data.parsedRows,
        })
        expect(commit.status).toBe(201)
        expect(commit.body.data.imported).toBe(2)
        expect(await Transaction.countDocuments({ accountId: account._id })).toBe(2)
    })

    it('a QIF renamed .qfx imports via the QIF path, not garbled CSV', async () => {
        const { token } = await seedUserDirectly({ email: 'qif-as-qfx@example.com' })
        const res = await parseFile(token, QIF, 'export.qfx')
        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('qif')
        expect(res.body.data.parsedRows).toHaveLength(2)
    })

    it('a truly malformed .qfx returns a clear error, not a CSV mapping screen', async () => {
        const { token } = await seedUserDirectly({ email: 'qfx-garbage@example.com' })
        const res = await parseFile(token, 'this is not a bank file at all', 'mystery.qfx')
        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/valid OFX\/QFX or QIF/i)
    })
})
