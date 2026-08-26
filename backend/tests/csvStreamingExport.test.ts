import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'
import { toMinorUnits } from '../../shared/src/money'

/**
 * Acceptance spec for C8 (streaming CSV export for large date ranges — the remaining half of the
 * old Phase 18.3; quoting/formula-injection neutralization was already fixed under C4).
 *
 * The prior implementation loaded every matching transaction into an array, rendered the whole
 * CSV into one string, then sent it via `res.send()` — Express computes and sets `Content-Length`
 * for a `send()` body, so the entire file exists in memory at once before the first byte reaches
 * the client. A large date range (thousands of transactions) means a correspondingly large
 * in-memory array of Mongoose docs plus a second full-size string.
 *
 * The fix streams rows off a DB cursor with `res.write()` per row. That is observable at the HTTP
 * layer without reaching into implementation details: a response Node can't size in advance uses
 * chunked transfer encoding and carries no `Content-Length` header, whereas a buffered `res.send()`
 * body always does. This suite pins that contract, plus correctness (row count, per-row content,
 * filtering, and formula-injection neutralization) against a realistic-volume dataset spanning a
 * multi-year date range.
 */

const TRANSACTION_COUNT = 300

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

/** Seed a wide, multi-year spread of posted transactions directly, bypassing per-request REST
 * overhead — the point is exercising the *export* read path at realistic volume, not creation. */
async function seedWideDateRangeTransactions(userId: string, accountId: string, categoryId: string) {
    const docs = Array.from({ length: TRANSACTION_COUNT }, (_, i) => ({
        userId,
        accountId,
        categoryId,
        type: i % 5 === 0 ? 'income' : ('expense' as const),
        status: 'posted' as const,
        amount: toMinorUnits(10 + (i % 200)),
        currency: 'USD',
        title: `Streamed row ${i}`,
        // Noon UTC keeps every row safely inside the 2020-2025 filter window regardless of the
        // test runner's local timezone offset (a local-midnight Date could otherwise cross a UTC
        // day boundary at the range's edges).
        date: new Date(Date.UTC(2020 + (i % 6), i % 12, (i % 27) + 1, 12, 0, 0)),
    }))

    await Transaction.insertMany(docs)
}

describe('C8 — streaming CSV export for large date ranges', () => {
    it('streams the CSV response (chunked, no Content-Length) instead of buffering it', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'csv-stream-headers@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(token)
        await seedWideDateRangeTransactions(userId, accountRes.body.data._id, categoryId)

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ startDate: '2020-01-01', endDate: '2025-12-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
        expect(res.headers['content-length']).toBeUndefined()
        expect(res.headers['transfer-encoding']).toBe('chunked')
    })

    it('still buffers JSON exports with a Content-Length (streaming is CSV-only)', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'csv-stream-json-pdf@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(token)
        await seedWideDateRangeTransactions(userId, accountRes.body.data._id, categoryId)

        const jsonRes = await request(app)
            .get('/api/v1/transactions/download')
            .query({ format: 'json' })
            .set(authHeader(token))
        expect(jsonRes.status).toBe(200)
        expect(jsonRes.headers['content-length']).toBeDefined()
    })

    it('streams every row correctly across a large multi-year date range', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'csv-stream-rows@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(token)
        await seedWideDateRangeTransactions(userId, accountRes.body.data._id, categoryId)

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ startDate: '2020-01-01', endDate: '2025-12-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        const lines = res.text.split('\n').filter((line) => line.length > 0)
        expect(lines[0]).toBe('Type,Title,Amount,Currency,Category,Date,Description,Source,Payment Method,Tags,Status')
        expect(lines.length).toBe(TRANSACTION_COUNT + 1)
        expect(lines.some((line) => line.includes('Streamed row 0'))).toBe(true)
        expect(lines.some((line) => line.includes('Streamed row 299'))).toBe(true)
    })

    it('applies the date-range filter on the streamed path (excludes rows outside the range)', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'csv-stream-filter@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(token)

        await Transaction.insertMany([
            {
                userId,
                accountId: accountRes.body.data._id,
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: toMinorUnits(50),
                currency: 'USD',
                title: 'In range',
                date: new Date('2026-01-15T12:00:00.000Z'),
            },
            {
                userId,
                accountId: accountRes.body.data._id,
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: toMinorUnits(75),
                currency: 'USD',
                title: 'Out of range',
                date: new Date('2019-06-01T12:00:00.000Z'),
            },
        ])

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.text).toContain('In range')
        expect(res.text).not.toContain('Out of range')
    })

    it('neutralizes a formula-injection payload on the streamed path (parity with C4)', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'csv-stream-formula@example.com' })
        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(token)

        await Transaction.insertMany([
            {
                userId,
                accountId: accountRes.body.data._id,
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: toMinorUnits(25),
                currency: 'USD',
                title: '=HYPERLINK("http://evil/","Click")',
                date: new Date('2026-01-15T12:00:00.000Z'),
            },
        ])

        const res = await request(app).get('/api/v1/transactions/download').set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.text).not.toMatch(/(?:^|,|")=HYPERLINK/m)
    })

    it('only scopes to the requesting user on the streamed path', async () => {
        const owner = await seedUserDirectly({ email: 'csv-stream-owner@example.com' })
        const other = await seedUserDirectly({ email: 'csv-stream-other@example.com' })

        const ownerAccount = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const otherAccount = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(other.token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
        const categoryId = await getFoodMasterId(owner.token)

        await Transaction.insertMany([
            {
                userId: owner.userId,
                accountId: ownerAccount.body.data._id,
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: toMinorUnits(10),
                currency: 'USD',
                title: 'Owner row',
                date: new Date('2026-01-15T12:00:00.000Z'),
            },
            {
                userId: other.userId,
                accountId: otherAccount.body.data._id,
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: toMinorUnits(10),
                currency: 'USD',
                title: 'Other row',
                date: new Date('2026-01-15T12:00:00.000Z'),
            },
        ])

        const res = await request(app).get('/api/v1/transactions/download').set(authHeader(owner.token))

        expect(res.status).toBe(200)
        expect(res.text).toContain('Owner row')
        expect(res.text).not.toContain('Other row')
    })
})
