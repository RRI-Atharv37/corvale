import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, seedUserDirectly } from './helpers'
import { sniffDelimiter, parseCsvContent } from '../../shared/src/csvImport'

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

function parseFile(token: string, content: string, filename: string, delimiter?: string) {
    const req = request(app).post('/api/v1/imports/parse').set(authHeader(token))
    if (delimiter !== undefined) {
        req.field('delimiter', delimiter)
    }
    return req.attach('file', Buffer.from(content, 'utf-8'), filename)
}

describe('BUG-19 — CSV delimiter detection', () => {
    it('sniffDelimiter picks the highest-count candidate, comma breaking ties', () => {
        expect(sniffDelimiter('Date;Description;Amount')).toBe(';')
        expect(sniffDelimiter('Date\tDescription\tAmount')).toBe('\t')
        expect(sniffDelimiter('Date|Description|Amount')).toBe('|')
        expect(sniffDelimiter('Date,Description,Amount')).toBe(',')
        // one of each → comma wins the tie
        expect(sniffDelimiter('a,b;c\td|e')).toBe(',')
        // ignores separators inside quotes
        expect(sniffDelimiter('"a;b;c",Amount')).toBe(',')
    })

    it('parseCsvContent auto-detects a semicolon file into real columns', () => {
        const { headers, rows, delimiter } = parseCsvContent(
            ['Date;Description;Amount', '2026-01-05;Kaufland;-12,50'].join('\n')
        )
        expect(delimiter).toBe(';')
        expect(headers).toEqual(['Date', 'Description', 'Amount'])
        expect(rows[0]).toEqual(['2026-01-05', 'Kaufland', '-12,50'])
    })

    it('parseCsvContent honours an explicit delimiter override', () => {
        // Comma-in-data would mis-sniff as comma; force semicolon.
        const { headers } = parseCsvContent('Date;Payee, Inc.;Amount\n2026-01-05;ACME, Inc.;-5', ';')
        expect(headers).toEqual(['Date', 'Payee, Inc.', 'Amount'])
    })

    it('POST /imports/parse detects a semicolon CSV with no delimiter field', async () => {
        const { token } = await seedUserDirectly({ email: 'delim-auto@example.com' })
        const res = await parseFile(
            token,
            ['Date;Description;Amount', '2026-01-05;Grocery;-45.50', '2026-01-06;Salary;2000'].join('\n'),
            'euro.csv'
        )
        expect(res.status).toBe(200)
        expect(res.body.data.delimiter).toBe(';')
        expect(res.body.data.headers).toEqual(['Date', 'Description', 'Amount'])
        expect(res.body.data.rows[0]).toEqual(['2026-01-05', 'Grocery', '-45.50'])
    })

    it('a semicolon CSV round-trips through preview + commit', async () => {
        const { token } = await seedUserDirectly({ email: 'delim-commit@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const parsed = await parseFile(
            token,
            ['Date;Description;Amount', '2026-02-01;Bakery;-3.20', '2026-02-02;Refund;5.00'].join('\n'),
            'euro.csv'
        )
        const commit = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: parsed.body.data.headers,
                rows: parsed.body.data.rows,
                mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
            })
        expect(commit.status).toBe(201)
        expect(commit.body.data.imported).toBe(2)
    })

    it('a comma CSV still parses as comma (regression)', async () => {
        const { token } = await seedUserDirectly({ email: 'delim-comma@example.com' })
        const res = await parseFile(
            token,
            ['Date,Description,Amount', '2026-01-05,Grocery,-45.50'].join('\n'),
            'us.csv'
        )
        expect(res.status).toBe(200)
        expect(res.body.data.delimiter).toBe(',')
        expect(res.body.data.headers).toEqual(['Date', 'Description', 'Amount'])
    })
})
