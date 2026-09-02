import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { authHeader, seedUserDirectly } from './helpers'
import { parseOfxContent } from '@shared/csvImport'

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

function previewImport(token: string, payload: Record<string, unknown>) {
    return request(app).post('/api/v1/imports/preview').set(authHeader(token)).send(payload)
}

const OFX = [
    'OFXHEADER:100',
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKACCTFROM><ACCTID>123</BANKACCTFROM><BANKTRANLIST>',
    '<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-45.50<DTPOSTED>20260105120000<NAME>Grocery Store<FITID>FIT-1</STMTTRN>',
    '<STMTTRN><TRNTYPE>CREDIT<TRNAMT>2000.00<DTPOSTED>20260106120000<NAME>Employer Payroll<FITID>FIT-2</STMTTRN>',
    '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
].join('\n')

describe('BUG-21 — OFX FITID / TRNTYPE / CURDEF', () => {
    it('parseOfxContent extracts FITID, maps TRNTYPE, surfaces CURDEF, and reports skipped blocks', () => {
        const withHold = OFX.replace(
            '</BANKTRANLIST>',
            '<STMTTRN><TRNTYPE>HOLD<DTPOSTED>20260107120000<NAME>Pending hold<FITID>FIT-3</STMTTRN></BANKTRANLIST>'
        )
        const result = parseOfxContent(withHold)
        expect(result.statementCurrency).toBe('EUR')
        expect(result.rows).toHaveLength(2)
        expect(result.rows[0]).toMatchObject({ type: 'expense', externalId: 'FIT-1' })
        expect(result.rows[1]).toMatchObject({ type: 'income', externalId: 'FIT-2' })
        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].message).toMatch(/missing an amount or date/i)
    })

    it('parse endpoint returns parsedRowErrors + statementCurrency', async () => {
        const { token } = await seedUserDirectly({ email: 'ofx-parse@example.com' })
        const withHold = OFX.replace(
            '</BANKTRANLIST>',
            '<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260107120000<NAME>Memo hold<FITID>FIT-3</STMTTRN></BANKTRANLIST>'
        )
        const res = await parseFile(token, withHold, 'statement.ofx')
        expect(res.status).toBe(200)
        expect(res.body.data.format).toBe('ofx')
        expect(res.body.data.statementCurrency).toBe('EUR')
        expect(res.body.data.parsedRowErrors).toHaveLength(1)
    })

    it('re-importing the same OFX flags every row as a FITID duplicate', async () => {
        const { token } = await seedUserDirectly({ email: 'ofx-fitid@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const first = await parseFile(token, OFX, 'statement.ofx')
        const commitPayload = {
            accountId: account._id,
            defaultCategoryId: categoryId,
            parsedRows: first.body.data.parsedRows,
        }
        const firstCommit = await commitImport(token, commitPayload)
        expect(firstCommit.status).toBe(201)
        expect(firstCommit.body.data.imported).toBe(2)

        const stored = await Transaction.find({ accountId: account._id }).select('externalId')
        expect(stored.map((t) => t.externalId).sort()).toEqual(['FIT-1', 'FIT-2'])

        const second = await parseFile(token, OFX, 'statement.ofx')
        const preview = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            parsedRows: second.body.data.parsedRows,
        })
        expect(preview.status).toBe(200)
        expect(preview.body.data.summary.duplicates).toBe(2)
        expect(preview.body.data.items.every((i: { duplicateOf?: unknown }) => i.duplicateOf)).toBe(true)

        const secondCommit = await commitImport(token, {
            ...commitPayload,
            parsedRows: second.body.data.parsedRows,
        })
        expect(secondCommit.body.data.imported).toBe(0)
        expect(secondCommit.body.data.skipped).toBe(2)
    })

    it('a description change between exports still dedupes when FITID matches', async () => {
        const { token } = await seedUserDirectly({ email: 'ofx-fitid-rename@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const first = await parseFile(token, OFX, 'statement.ofx')
        await commitImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            parsedRows: first.body.data.parsedRows,
        })

        const renamed = OFX.replace('Grocery Store', 'GROCERY STORE #4821 POS')
        const second = await parseFile(token, renamed, 'statement.ofx')
        const preview = await previewImport(token, {
            accountId: account._id,
            defaultCategoryId: categoryId,
            parsedRows: second.body.data.parsedRows,
        })
        expect(preview.body.data.summary.duplicates).toBe(2)
    })
})
