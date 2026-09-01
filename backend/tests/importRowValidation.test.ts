import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '../app'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Acceptance spec for S32 — SEC-52 (`backend/controllers/importController.ts`).
 *
 * `resolveRowsAndErrors` returned `parsedRows as ParsedImportRow[]` with no per-row validation,
 * and `commitImport` wrote `type: item.type` straight into `Transaction.create`. Nothing
 * constrained `type` to `income | expense`, so a posted `{ "type": "transfer" }` row created an
 * orphan transfer leg that skews the account balance and is thereafter rejected by
 * `assertEditableTransaction` — an unfixable corrupt row, reachable with no file upload and no
 * prior `/imports/parse` call.
 *
 * Contract: every entry of a client-supplied `parsedRows` array is validated server-side —
 * `type` constrained to the transaction income/expense enum, `date` to `YYYY-MM-DD`, `title`
 * non-empty, `amount` a finite positive number — and a bad row is a 400 with nothing written.
 */

const createAccount = async (token: string) => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
    return res.body.data
}

const getFoodMasterId = async (token: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

const validRow = (overrides: Record<string, unknown> = {}) => ({
    rowIndex: 1,
    date: '2026-01-15',
    title: 'Coffee shop',
    amount: 4.5,
    type: 'expense',
    ...overrides,
})

describe('SEC-52 — server-side parsedRows validation', () => {
    it('rejects a commit whose parsedRows carries type "transfer" and writes nothing', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'sec52-transfer@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                parsedRows: [validRow({ type: 'transfer' })],
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/type|invalid/i)
        expect(await Transaction.countDocuments({ userId })).toBe(0)
    })

    it('rejects an arbitrary type string on preview', async () => {
        const { token } = await seedUserDirectly({ email: 'sec52-preview-type@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/preview')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                parsedRows: [validRow({ type: 'DROP TABLE' })],
            })

        expect(res.status).toBe(400)
    })

    it('rejects a malformed date', async () => {
        const { token } = await seedUserDirectly({ email: 'sec52-baddate@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                parsedRows: [validRow({ date: '15/01/2026' })],
            })

        expect(res.status).toBe(400)
    })

    it('rejects a non-numeric / non-positive amount', async () => {
        const { token } = await seedUserDirectly({ email: 'sec52-badamount@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        for (const amount of [false, [], 0, -5, 'abc']) {
            const res = await request(app)
                .post('/api/v1/imports/commit')
                .set(authHeader(token))
                .send({
                    accountId: account._id,
                    defaultCategoryId: categoryId,
                    parsedRows: [validRow({ amount })],
                })
            expect(res.status).toBe(400)
        }
    })

    it('rejects an empty title', async () => {
        const { token } = await seedUserDirectly({ email: 'sec52-notitle@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                parsedRows: [validRow({ title: '   ' })],
            })

        expect(res.status).toBe(400)
    })

    it('still commits a well-formed income/expense parsedRows payload', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'sec52-happy@example.com' })
        const account = await createAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(token))
            .send({
                accountId: account._id,
                defaultCategoryId: categoryId,
                parsedRows: [
                    validRow({ rowIndex: 1, type: 'expense', amount: 4.5, title: 'Coffee' }),
                    validRow({ rowIndex: 2, type: 'income', amount: 2000, title: 'Payroll' }),
                ],
            })

        expect(res.status).toBe(201)
        expect(res.body.data.imported).toBe(2)

        const written = await Transaction.find({ userId }).sort({ amount: 1 })
        expect(written.map((t) => t.type)).toEqual(['expense', 'income'])
    })
})
