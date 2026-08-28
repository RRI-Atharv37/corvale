import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, registerUser, createTestIncome, createTestExpense } from './helpers'

/**
 * Acceptance spec for SEC-29 (S22): the legacy `GET /income/download` and `GET /expense/download`
 * exports must inherit the same CSV hardening every other export path already has.
 *
 * Before S22 both controllers built the file with a bare `rows.map((r) => r.join(',')).join('\n')`
 * — no RFC 4180 quoting and no formula neutralization. That is two distinct defects:
 *   1. Formula injection — a title beginning with `=`/`+`/`-`/`@` executes on open in a spreadsheet.
 *   2. Structure injection — a comma, quote, or newline in a free-text field corrupts the row,
 *      and a newline lets a user forge arbitrary extra rows.
 *
 * The fix routes both controllers through `buildCsvString` from `utils/transactionUtils.ts`
 * (the same choke point `escapeCsvValue` guards for the `Transaction` export). This spec pins the
 * observable behaviour, not the implementation choice.
 */

describe('legacy income/expense CSV export hardening (SEC-29, S22)', () => {
    describe('GET /api/v1/income/download', () => {
        it('neutralizes a formula-injection payload in the income title', async () => {
            const { token } = await registerUser(app)
            await createTestIncome(app, token, 1000, '=HYPERLINK("http://evil/","Click")')

            const res = await request(app).get('/api/v1/income/download').set(authHeader(token))

            expect(res.status).toBe(200)
            // The dangerous prefix must not survive at the start of a field (raw or quoted).
            expect(res.text).not.toMatch(/(?:^|,|")=HYPERLINK/m)
        })

        it('RFC 4180-quotes a comma in a free-text field so the row structure is preserved', async () => {
            const { token } = await registerUser(app)
            await createTestIncome(app, token, 500, 'Salary, bonus and tips')

            const res = await request(app).get('/api/v1/income/download').set(authHeader(token))

            expect(res.status).toBe(200)
            const dataLine = res.text.split('\n')[1]
            expect(dataLine).toContain('"Salary, bonus and tips"')
            // Header (6 columns) and the quoted data row must both have 6 fields.
            expect(res.text.split('\n')[0].split(',')).toHaveLength(6)
        })

        it('quotes a newline so a user cannot forge extra CSV rows via a description', async () => {
            const { token } = await registerUser(app)
            await createTestIncome(app, token, 250, 'Refund')
            // Update the created income to carry a newline-laden description.
            const list = await request(app).get('/api/v1/income').set(authHeader(token))
            const incomeId = list.body.data.data[0]._id
            await request(app)
                .put(`/api/v1/income/${incomeId}`)
                .set(authHeader(token))
                .send({ description: 'legit\n=cmd|calc,forged,row,here' })

            const res = await request(app).get('/api/v1/income/download').set(authHeader(token))

            expect(res.status).toBe(200)
            // Exactly one header line + one data line (the newline is contained inside a quoted field).
            const lines = res.text.split('\n')
            expect(lines[0]).toMatch(/^Source,Title,Date,Amount,Description,Category$/)
            expect(res.text).not.toMatch(/^=cmd/m)
        })
    })

    describe('GET /api/v1/expense/download', () => {
        it('neutralizes a formula-injection payload in the expense title', async () => {
            const { token } = await registerUser(app)
            await createTestExpense(app, token, 42, '=1+1')

            const res = await request(app).get('/api/v1/expense/download').set(authHeader(token))

            expect(res.status).toBe(200)
            expect(res.text).not.toMatch(/(?:^|,|")=1\+1/m)
        })

        it('emits a header row of discrete columns and quotes commas in the body', async () => {
            const { token } = await registerUser(app)
            await createTestExpense(app, token, 99, 'Dinner, drinks')

            const res = await request(app).get('/api/v1/expense/download').set(authHeader(token))

            expect(res.status).toBe(200)
            const [header, dataLine] = res.text.split('\n')
            expect(header.split(',')).toEqual([
                'Title',
                'Amount',
                'Description',
                'Category',
                'Date',
                'Payment Method',
                'Recurring',
                'Tags',
            ])
            expect(dataLine).toContain('"Dinner, drinks"')
        })
    })
})
