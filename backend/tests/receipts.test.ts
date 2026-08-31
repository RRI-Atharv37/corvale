import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import app from '../app'
import Transaction from '../models/Transaction'
import Receipt from '../models/Receipt'
import { authHeader, createSecondUser, registerUser } from './helpers'
import { RECEIPT_UPLOAD_ROOT } from '../utils/receiptUtils'

const FIXTURE_PNG = path.join(__dirname, 'fixtures', 'sample-receipt.png')

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

async function createTestExpense(token: string) {
    const account = await createTestAccount(token)
    const categoryId = await getFoodMasterId(token)
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Receipt test expense',
            amount: 12.5,
            date: '2026-01-15T12:00:00.000Z',
            accountId: account._id,
            categoryId,
        })
    return res.body.data
}

afterEach(() => {
    if (fs.existsSync(RECEIPT_UPLOAD_ROOT)) {
        fs.rmSync(RECEIPT_UPLOAD_ROOT, { recursive: true, force: true })
    }
})

describe('Receipts', () => {
    it('registers POST /api/v1/receipts (not 404)', async () => {
        const res = await request(app).post('/api/v1/receipts')
        expect(res.status).not.toBe(404)
        expect(res.status).toBe(401)
    })

    it('uploads a receipt with auth', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(res.status).toBe(201)
        expect(res.body.success).toBe(true)
        expect(res.body.data.originalFilename).toBe('sample-receipt.png')
        expect(res.body.data.mimeType).toMatch(/^image\//)

        const receipt = await Receipt.findById(res.body.data._id)
        expect(receipt).not.toBeNull()
    })

    it('rejects invalid file types', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', Buffer.from('not-a-receipt'), 'notes.txt')

        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/JPEG|PNG|WebP|PDF/i)
    })

    it('SEC-62: rejects a multipart upload with an excessive number of text fields', async () => {
        const { token } = await registerUser(app)

        let req = request(app).post('/api/v1/receipts').set(authHeader(token)).attach('receipt', FIXTURE_PNG)
        for (let i = 0; i < 12; i += 1) {
            req = req.field(`extra${i}`, String(i))
        }
        const res = await req

        expect(res.status).toBe(400)
    })

    it('SEC-62: rejects a multipart upload with an oversized text field', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)
            .field('blob', 'x'.repeat(128 * 1024))

        expect(res.status).toBe(400)
    })

    it('attaches and detaches a receipt on a transaction', async () => {
        const { token } = await registerUser(app)
        const transaction = await createTestExpense(token)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        expect(uploadRes.status).toBe(201)
        const receiptId = uploadRes.body.data._id

        const attachRes = await request(app)
            .post(`/api/v1/transactions/${transaction._id}/receipts`)
            .set(authHeader(token))
            .send({ receiptId })

        expect(attachRes.status).toBe(200)
        expect(attachRes.body.data.receipts).toHaveLength(1)
        expect(attachRes.body.data.receipts[0]._id).toBe(receiptId)

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.receiptIds?.map(String)).toContain(receiptId)

        const detachRes = await request(app)
            .delete(`/api/v1/transactions/${transaction._id}/receipts/${receiptId}`)
            .set(authHeader(token))

        expect(detachRes.status).toBe(200)
        expect(detachRes.body.data.receipts ?? []).toHaveLength(0)
    })

    it('serves uploaded receipt file', async () => {
        const { token, userId } = await registerUser(app)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        const receiptId = uploadRes.body.data._id

        const fileRes = await request(app)
            .get(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(token))

        expect(fileRes.status).toBe(200)
        expect(fileRes.headers['content-type']).toMatch(/^image\//)

        const userDir = path.join(RECEIPT_UPLOAD_ROOT, userId)
        expect(fs.existsSync(userDir)).toBe(true)
        expect(fs.readdirSync(userDir).length).toBeGreaterThan(0)
    })

    it('deletes a receipt and unlinks it from transactions', async () => {
        const { token } = await registerUser(app)
        const transaction = await createTestExpense(token)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(token))
            .attach('receipt', FIXTURE_PNG)

        const receiptId = uploadRes.body.data._id

        await request(app)
            .post(`/api/v1/transactions/${transaction._id}/receipts`)
            .set(authHeader(token))
            .send({ receiptId })

        const deleteRes = await request(app)
            .delete(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(token))

        expect(deleteRes.status).toBe(200)

        const storedReceipt = await Receipt.findById(receiptId)
        expect(storedReceipt).toBeNull()

        const storedTx = await Transaction.findById(transaction._id)
        expect(storedTx?.receiptIds ?? []).toHaveLength(0)
    })

    it('returns 403 when accessing another user receipt', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const uploadRes = await request(app)
            .post('/api/v1/receipts')
            .set(authHeader(owner.token))
            .attach('receipt', FIXTURE_PNG)

        const receiptId = uploadRes.body.data._id

        const fileRes = await request(app)
            .get(`/api/v1/receipts/${receiptId}`)
            .set(authHeader(other.token))

        expect(fileRes.status).toBe(403)
    })
})
