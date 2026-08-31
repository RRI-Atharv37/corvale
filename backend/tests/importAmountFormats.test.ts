import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { mapCsvRows } from '../utils/csvImportUtils'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * BUG-20 — amount parsing stripped only `$` and commas, so a non-`$` currency symbol failed the
 * row and a European-formatted number (`.` thousands, `,` decimal) was silently misread by up to
 * 1000x (`1.234,56` → `1.23456`). The fix routes the signed-amount column and the debit/credit
 * columns through a shared `parseImportAmount` that strips any surrounding symbol/code and infers
 * the decimal separator. Mirrors the BUG-18 date-format suite.
 */

const HEADERS = ['Date', 'Description', 'Amount']

const mapAmounts = (amountCells: string[]) =>
    mapCsvRows(
        HEADERS,
        amountCells.map((amount, index) => [
            `2026-01-${String(index + 1).padStart(2, '0')}`,
            `Row ${index}`,
            amount,
        ]),
        { date: 'Date', description: 'Description', amount: 'Amount' }
    )

describe('csvImport amount formats (BUG-20) — mapCsvRows unit', () => {
    it('still strips a leading $, thousands commas and parens/sign (unchanged US behaviour)', () => {
        const { rows, errors } = mapAmounts(['$1,250.00', '-$40.00', '(40.00)', '2000'])
        expect(errors).toHaveLength(0)
        expect(rows[0]).toMatchObject({ amount: 1250, type: 'income' })
        expect(rows[1]).toMatchObject({ amount: 40, type: 'expense' })
        expect(rows[2]).toMatchObject({ amount: 40, type: 'expense' })
        expect(rows[3]).toMatchObject({ amount: 2000, type: 'income' })
    })

    it('reads a European decimal-comma amount instead of multiplying it by 100 (the core BUG-20 defect)', () => {
        const { rows, errors } = mapAmounts(['1.234,56'])
        expect(errors).toHaveLength(0)
        expect(rows[0].amount).toBeCloseTo(1234.56, 2)
    })

    it('reads French space-grouped and dot-grouped European amounts', () => {
        const { rows, errors } = mapAmounts(['1 234,56', '1.234.567,89'])
        expect(errors).toHaveLength(0)
        expect(rows[0].amount).toBeCloseTo(1234.56, 2)
        expect(rows[1].amount).toBeCloseTo(1234567.89, 2)
    })

    it('reads an Indian-grouped amount (1,00,000.00)', () => {
        const { rows, errors } = mapAmounts(['1,00,000.00'])
        expect(errors).toHaveLength(0)
        expect(rows[0].amount).toBe(100000)
    })

    it('accepts non-dollar currency symbols and ISO codes on either side of the number', () => {
        const { rows, errors } = mapAmounts(['€40.00', '£40.00', '₹40.00', '¥40', 'INR 500', '500 INR'])
        expect(errors).toHaveLength(0)
        expect(rows.map((row) => row.amount)).toEqual([40, 40, 40, 40, 500, 500])
    })

    it('treats a lone comma with 1–2 trailing digits as a decimal comma', () => {
        const { rows, errors } = mapAmounts(['40,00', '40,5'])
        expect(errors).toHaveLength(0)
        expect(rows[0].amount).toBe(40)
        expect(rows[1].amount).toBeCloseTo(40.5, 2)
    })

    it('treats a lone comma with 3+ trailing digits as a thousands separator', () => {
        const { rows, errors } = mapAmounts(['1,250'])
        expect(errors).toHaveLength(0)
        expect(rows[0].amount).toBe(1250)
    })

    it('reads a signed European amount and infers the direction', () => {
        const { rows, errors } = mapAmounts(['-1.234,56', '(2.000,00)'])
        expect(errors).toHaveLength(0)
        expect(rows[0]).toMatchObject({ type: 'expense' })
        expect(rows[0].amount).toBeCloseTo(1234.56, 2)
        expect(rows[1]).toMatchObject({ type: 'expense' })
        expect(rows[1].amount).toBe(2000)
    })

    it('rejects a value with no parseable number and an ambiguous multi-dot value', () => {
        const { rows, errors } = mapAmounts(['not money', '1.2.3'])
        expect(rows).toHaveLength(0)
        expect(errors).toHaveLength(2)
        expect(errors[0].message).toMatch(/amount/i)
    })

    it('applies the same locale-aware parsing to debit and credit columns', () => {
        const { rows, errors } = mapCsvRows(
            ['Date', 'Description', 'Debit', 'Credit'],
            [
                ['2026-01-05', 'Groceries', '1.234,56', ''],
                ['2026-01-06', 'Salary', '', '2.000,00'],
                ['2026-01-07', 'Fee', '€3,50', ''],
            ],
            { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' }
        )
        expect(errors).toHaveLength(0)
        expect(rows[0]).toMatchObject({ type: 'expense' })
        expect(rows[0].amount).toBeCloseTo(1234.56, 2)
        expect(rows[1]).toMatchObject({ type: 'income' })
        expect(rows[1].amount).toBe(2000)
        expect(rows[2].amount).toBeCloseTo(3.5, 2)
    })
})

describe('POST /imports/preview + /imports/commit — locale amount passthrough', () => {
    async function createAccount(token: string) {
        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        return res.body.data
    }

    async function getFoodMasterId(token: string): Promise<string> {
        const res = await request(app).get('/api/v1/categories').set(authHeader(token))
        return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
    }

    it('previews a decimal-comma file at the correct magnitude', async () => {
        const { token } = await seedUserDirectly({ email: 'import-eu-amount-preview@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/preview')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: ['Date', 'Description', 'Amount'],
                rows: [['2026-01-05', 'Weekend market', '-1.234,56']],
                mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
            })

        expect(res.status).toBe(200)
        expect(res.body.data.summary.valid).toBe(1)
        expect(res.body.data.items[0].amount).toBeCloseTo(1234.56, 2)
        expect(res.body.data.items[0].type).toBe('expense')
    })

    it('commits a non-dollar-symbol amount at face value', async () => {
        const { token } = await seedUserDirectly({ email: 'import-eu-amount-commit@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: ['Date', 'Description', 'Amount'],
                rows: [['2026-01-05', 'Chai stall', '-₹1,250.50']],
                mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
            })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(1)

        const account2 = await request(app)
            .get(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))
        expect(account2.body.data.currentBalance).toBeCloseTo(1000 - 1250.5, 2)
    })
})
