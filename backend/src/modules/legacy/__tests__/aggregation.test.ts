import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Expense } from '@modules/legacy'
import { authHeader, registerUser } from '@tests/helpers'

describe('Expense aggregation', () => {
    it('group-by-category returns correct totals', async () => {
        const { token, userId } = await registerUser(app)

        await Expense.create([
            {
                userId,
                title: 'Groceries',
                amount: 100,
                category: 'Food',
                date: new Date('2026-01-15'),
            },
            {
                userId,
                title: 'Restaurant',
                amount: 50,
                category: 'Food',
                date: new Date('2026-01-20'),
            },
            {
                userId,
                title: 'Bus pass',
                amount: 75,
                category: 'Transport',
                date: new Date('2026-01-10'),
            },
        ])

        const res = await request(app)
            .get('/api/v1/expense/group-by-category')
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)

        const groups = res.body.data as Array<{ _id: string; totalAmount: number }>
        const food = groups.find((g) => g._id === 'Food')
        const transport = groups.find((g) => g._id === 'Transport')

        expect(food?.totalAmount).toBe(150)
        expect(transport?.totalAmount).toBe(75)
    })
})
