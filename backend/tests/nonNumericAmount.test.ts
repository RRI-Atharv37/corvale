import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Transaction from '../models/Transaction'
import { authHeader, seedUserDirectly } from './helpers'
import { parseAmountToMinorUnits } from '../../shared/src/money'
import { parseClientAmount } from '../utils/transactionUtils'

async function createAccount(token: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

describe('BUG-13 — non-numeric amount is rejected, not coerced to $0', () => {
    describe('parseAmountToMinorUnits (shared)', () => {
        it.each([false, true, [], [5], {}, null, undefined])(
            'throws for %s instead of returning 0',
            (value) => {
                expect(() => parseAmountToMinorUnits(value as unknown)).toThrow(/invalid amount/i)
            }
        )

        it('still accepts numbers and numeric strings', () => {
            expect(parseAmountToMinorUnits(45.25)).toBe(4525)
            expect(parseAmountToMinorUnits('45.25')).toBe(4525)
            expect(parseAmountToMinorUnits(0)).toBe(0)
        })
    })

    describe('parseClientAmount (backend wrapper)', () => {
        it.each([false, [], {}])('maps %s to a 400', (value) => {
            expect(() => parseClientAmount(value as unknown)).toThrow(
                expect.objectContaining({ statusCode: 400 })
            )
        })
    })

    describe('POST /transactions', () => {
        it.each([
            ['false', false],
            ['[]', []],
        ])('rejects amount: %s with 400 and creates nothing', async (_label, amount) => {
            const { token } = await seedUserDirectly({ email: `bug13-${_label}@example.com` })
            const account = await createAccount(token)
            const categoryId = await getFoodMasterId(token)

            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: 'Bad amount',
                    amount,
                    date: '2026-01-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                })

            expect(res.status).toBe(400)
            expect(await Transaction.countDocuments({})).toBe(0)
        })

        it('still creates a transaction for a valid numeric string amount', async () => {
            const { token } = await seedUserDirectly({ email: 'bug13-valid@example.com' })
            const account = await createAccount(token)
            const categoryId = await getFoodMasterId(token)

            const res = await request(app)
                .post('/api/v1/transactions')
                .set(authHeader(token))
                .send({
                    type: 'expense',
                    title: 'Groceries',
                    amount: '45.25',
                    date: '2026-01-15T12:00:00.000Z',
                    accountId: account._id,
                    categoryId,
                })

            expect(res.status).toBe(201)
            expect(res.body.data.amount).toBe(45.25)
        })
    })

    describe('POST /transactions/transfer', () => {
        it('rejects amount: false with 400', async () => {
            const { token } = await seedUserDirectly({ email: 'bug13-transfer@example.com' })
            const from = await createAccount(token, 400)
            const toRes = await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(token))
                .send({ name: 'Cash', type: 'cash', openingBalance: 50 })

            const res = await request(app)
                .post('/api/v1/transactions/transfer')
                .set(authHeader(token))
                .send({
                    title: 'Bad transfer',
                    amount: false,
                    date: '2026-01-01T12:00:00.000Z',
                    fromAccountId: from._id,
                    toAccountId: toRes.body.data._id,
                })

            expect(res.status).toBe(400)
            expect(await Transaction.countDocuments({})).toBe(0)
        })
    })
})
