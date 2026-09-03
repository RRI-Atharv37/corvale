import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { mapCsvRows } from "@modules/import/csvImportUtils";

/**
 * BUG-18 — day-first CSV dates were silently misread (hardcoded month-first + `Date.UTC`
 * month rollover), sometimes landing on a different year with no error. The fix adds a
 * `dateFormat` control (`auto` | `YMD` | `MDY` | `DMY`) to the column mapping, threaded into
 * `parseDateValue`, and rejects an out-of-range date instead of rolling it forward.
 */

const HEADERS = ['Date', 'Description', 'Amount']
const map = (rows: string[][], dateFormat?: string) =>
    mapCsvRows(HEADERS, rows, {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        ...(dateFormat ? { dateFormat: dateFormat as 'auto' | 'YMD' | 'MDY' | 'DMY' } : {}),
    })

describe('csvImport date formats (BUG-18) — mapCsvRows unit', () => {
    it('still reads ISO YYYY-MM-DD regardless of the dateFormat setting', () => {
        for (const fmt of [undefined, 'auto', 'MDY', 'DMY', 'YMD']) {
            const { rows, errors } = map([['2026-03-07', 'ISO row', '-10.00']], fmt)
            expect(errors).toHaveLength(0)
            expect(rows[0].date).toBe('2026-03-07')
        }
    })

    it('defaults an all-ambiguous slash column to US month-first (unchanged behaviour)', () => {
        const { rows, errors } = map([
            ['03/07/2026', 'Ambiguous', '-10.00'],
            ['04/09/2026', 'Ambiguous', '-11.00'],
        ])
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-03-07')
        expect(rows[1].date).toBe('2026-04-09')
    })

    it('auto-detects day-first when any first token is > 12', () => {
        const { rows, errors } = map([
            ['12/06/2026', 'Six June', '-10.00'],
            ['25/12/2026', 'Christmas', '-20.00'],
        ])
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-06-12')
        expect(rows[1].date).toBe('2026-12-25')
    })

    it('auto-detects month-first when any second token is > 12', () => {
        const { rows, errors } = map([
            ['06/12/2026', 'Twelve June', '-10.00'],
            ['03/25/2026', 'Late March', '-20.00'],
        ])
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-06-12')
        expect(rows[1].date).toBe('2026-03-25')
    })

    it('honours an explicit DMY setting for a column that would otherwise look ambiguous', () => {
        const { rows, errors } = map([['03/07/2026', 'Seventh March', '-10.00']], 'DMY')
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-07-03')
    })

    it('honours an explicit MDY setting', () => {
        const { rows, errors } = map([['03/07/2026', 'Third July', '-10.00']], 'MDY')
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-03-07')
    })

    it('reads YMD slash/dot dates', () => {
        const { rows, errors } = map(
            [
                ['2026/03/07', 'Slash YMD', '-10.00'],
                ['2026.03.08', 'Dot YMD', '-11.00'],
            ],
            'YMD'
        )
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-03-07')
        expect(rows[1].date).toBe('2026-03-08')
    })

    it('accepts "." and "-" separators for day-first dates', () => {
        const { rows, errors } = map([
            ['25.12.2026', 'Dot', '-10.00'],
            ['25-12-2026', 'Dash', '-11.00'],
        ])
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-12-25')
        expect(rows[1].date).toBe('2026-12-25')
    })

    it('REJECTS an out-of-range date instead of rolling it forward (the core BUG-18 defect)', () => {
        // 25/12/2026 under month-first: month "25" previously rolled to 2028-01-12.
        const { rows, errors } = map([['25/12/2026', 'Christmas', '-20.00']], 'MDY')
        expect(rows).toHaveLength(0)
        expect(errors).toHaveLength(1)
        expect(errors[0].message).toMatch(/date/i)
    })

    it('rejects an impossible day (02/30) rather than rolling into the next month', () => {
        const { rows, errors } = map([['02/30/2026', 'Nonexistent', '-20.00']], 'MDY')
        expect(rows).toHaveLength(0)
        expect(errors).toHaveLength(1)
    })

    it('expands two-digit years the same way for day-first dates', () => {
        const { rows, errors } = map([['07/03/26', 'Two digit', '-10.00']], 'DMY')
        expect(errors).toHaveLength(0)
        expect(rows[0].date).toBe('2026-03-07')
    })
})

describe('POST /imports/preview + /imports/commit — dateFormat passthrough', () => {
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

    it('previews a day-first file correctly when the mapping carries dateFormat: DMY', async () => {
        const { token } = await seedUserDirectly({ email: 'import-dmy-preview@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/preview')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: HEADERS,
                rows: [['25/12/2026', 'Christmas Market', '-20.00']],
                mapping: {
                    date: 'Date',
                    description: 'Description',
                    amount: 'Amount',
                    dateFormat: 'DMY',
                },
            })

        expect(res.status).toBe(200)
        expect(res.body.data.summary.valid).toBe(1)
        expect(res.body.data.items[0].date).toBe('2026-12-25')
    })

    it('commits day-first rows to the correct calendar dates', async () => {
        const { token } = await seedUserDirectly({ email: 'import-dmy-commit@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: HEADERS,
                rows: [['13/06/2026', 'Day first', '-15.00']],
                mapping: {
                    date: 'Date',
                    description: 'Description',
                    amount: 'Amount',
                    dateFormat: 'auto',
                },
            })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(1)
    })

    it('ignores an unrecognised dateFormat value and falls back to auto', async () => {
        const { token } = await seedUserDirectly({ email: 'import-bad-format@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/preview')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                headers: HEADERS,
                rows: [['2026-03-07', 'ISO', '-10.00']],
                mapping: {
                    date: 'Date',
                    description: 'Description',
                    amount: 'Amount',
                    dateFormat: 'nonsense',
                },
            })

        expect(res.status).toBe(200)
        expect(res.body.data.items[0].date).toBe('2026-03-07')
    })
})
