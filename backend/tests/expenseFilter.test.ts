import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Expense } from '@modules/legacy'
import { authHeader, registerUser } from './helpers'

describe('Expense date range filter', () => {
    it('returns only expenses within the date range', async () => {
        const { token, userId } = await registerUser(app)

        await Expense.create([
            {
                userId,
                title: 'Early expense',
                amount: 10,
                category: 'Misc',
                date: new Date('2026-01-05'),
            },
            {
                userId,
                title: 'In-range expense',
                amount: 20,
                category: 'Misc',
                date: new Date('2026-01-15'),
            },
            {
                userId,
                title: 'Late expense',
                amount: 30,
                category: 'Misc',
                date: new Date('2026-02-01'),
            },
        ])

        const res = await request(app)
            .get('/api/v1/expense/filter')
            .query({ startDate: '2026-01-10', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('In-range expense')
    })

    it('returns 200 with empty array when no expenses match', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/expense/filter')
            .query({ startDate: '2026-03-01', endDate: '2026-03-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data).toEqual([])
    })
})
