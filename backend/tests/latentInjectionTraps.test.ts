import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '../app'
import { authHeader, registerUser } from './helpers'
import { RECEIPT_UPLOAD_ROOT } from '../utils/receiptUtils'

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

/**
 * Acceptance spec for S26 (SEC-34, SEC-35) — the two latent injection/bypass traps.
 *
 * SEC-34: `attachBudgetContextToNotifications` must resolve budget progress for a
 *   notification's own budget WITHOUT an RLS bypass — the budget lookup is now scoped
 *   by the caller's `userId`.
 *
 * SEC-35:
 *   (a) `req.query.accountId` reaching `buildListFilter` must be validated as an ObjectId,
 *       since `sanitizeBody` guards `req.body` only.
 *   (b) The query parser is pinned to 'simple', so a bracketed operator in the query
 *       string parses to a literal key rather than a nested Mongo operator object.
 *   (c) `sanitizeBody` must run again after multer on the four multipart routes
 *       (`POST /receipts`, `POST /imports/parse`, `POST /backup/preview`,
 *       `POST /backup/restore`), whose `req.body` is empty at app-level guard time.
 */

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')
const UNSAFE_BODY_MESSAGE = 'Request body contains invalid characters'

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

describe('SEC-34 — budget context on notifications resolves without an RLS bypass', () => {
    it('attaches budget progress to an over-limit notification for the budget owner', async () => {
        const { token } = await registerUser(app, { email: 'sec34-owner@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                name: 'Food budget',
                periodType: 'monthly',
                year: 2026,
                month: 1,
                amount: 100,
                categoryId,
            })

        const expenseRes = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Groceries',
                amount: 150,
                date: '2026-01-15T12:00:00.000Z',
                accountId: account._id,
                categoryId,
            })
        expect(expenseRes.status).toBe(201)

        const res = await request(app).get('/api/v1/notifications').set(authHeader(token))

        expect(res.status).toBe(200)
        const notification = res.body.data.notifications.find(
            (n: { referenceType: string }) => n.referenceType === 'budget'
        )
        expect(notification).toBeTruthy()
        expect(notification.metadata.progress).toBeTruthy()
        expect(notification.metadata.progress.isOverBudget).toBe(true)
    })
})

describe('SEC-35(a) — accountId query filter is validated as an ObjectId', () => {
    it('rejects a non-ObjectId accountId with 400', async () => {
        const { token } = await registerUser(app, { email: 'sec35-badid@example.com' })

        const res = await request(app)
            .get('/api/v1/transactions')
            .query({ accountId: 'not-an-object-id' })
            .set(authHeader(token))

        expect(res.status).toBe(400)
    })

    it('rejects an operator-shaped accountId string with 400', async () => {
        const { token } = await registerUser(app, { email: 'sec35-opid@example.com' })

        const res = await request(app)
            .get(`/api/v1/transactions?accountId=${encodeURIComponent('{"$ne":null}')}`)
            .set(authHeader(token))

        // With the 'simple' query parser this arrives as the literal string `{"$ne":null}`,
        // not a nested object, so it simply fails ObjectId validation.
        expect(res.status).toBe(400)
    })

    it('accepts a well-formed ObjectId accountId', async () => {
        const { token } = await registerUser(app, { email: 'sec35-goodid@example.com' })
        const account = await createTestAccount(token)

        const res = await request(app)
            .get('/api/v1/transactions')
            .query({ accountId: account._id })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('treats a bracketed operator key in the query string as a literal, not a Mongo operator', async () => {
        const { token } = await registerUser(app, { email: 'sec35-bracket@example.com' })

        const res = await request(app)
            .get('/api/v1/transactions?accountId[$ne]=')
            .set(authHeader(token))

        // `accountId[$ne]` is a distinct literal key; `accountId` itself is undefined, so
        // no accountId filter is applied and the request succeeds.
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })
})

describe('SEC-35(c) — sanitizeBody runs after multer on multipart routes', () => {
    it('rejects an operator key in a receipt upload text field', async () => {
        const { token } = await registerUser(app, { email: 'sec35-receipt@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .field('$where', 'sleep(1000)')
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(UNSAFE_BODY_MESSAGE)
    })

    it('rejects a dotted key in an import parse text field', async () => {
        const { token } = await registerUser(app, { email: 'sec35-import@example.com' })

        const res = await request(app)
            .post('/api/v1/imports/parse')
            .set(authHeader(token))
            .field('meta.$ne', '1')
            .attach('file', Buffer.from('Date,Description,Amount\n2026-01-05,X,-1\n', 'utf-8'), 'x.csv')

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(UNSAFE_BODY_MESSAGE)
    })

    it('rejects an operator key in a backup preview text field', async () => {
        const { token } = await registerUser(app, { email: 'sec35-preview@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/preview')
            .set(authHeader(token))
            .field('$gt', '')
            .attach('file', Buffer.from('{}', 'utf-8'), 'backup.json')

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(UNSAFE_BODY_MESSAGE)
    })

    it('rejects an operator key in a backup restore text field', async () => {
        const { token } = await registerUser(app, { email: 'sec35-restore@example.com' })

        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(token))
            .field('$gt', '')
            .attach('file', Buffer.from('{}', 'utf-8'), 'backup.json')

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(UNSAFE_BODY_MESSAGE)
    })

    it('still accepts a clean multipart receipt upload', async () => {
        const { token } = await registerUser(app, { email: 'sec35-clean@example.com' })

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
    })
})

describe('SEC-35 sanity — Types.ObjectId.isValid guards as expected', () => {
    it('rejects short hex-ish strings that are not 24 hex chars', () => {
        expect(Types.ObjectId.isValid('12345')).toBe(false)
    })
})
