import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Income } from '@modules/legacy'
import { authHeader, registerUser } from '@tests/helpers'

describe('Income date range filter', () => {
    it('returns only income within the date range', async () => {
        const { token, userId } = await registerUser(app)

        await Income.create([
            {
                userId,
                title: 'January salary',
                amount: 3000,
                date: new Date('2026-01-01'),
            },
            {
                userId,
                title: 'Mid-month freelance',
                amount: 500,
                date: new Date('2026-01-15'),
            },
            {
                userId,
                title: 'February salary',
                amount: 3000,
                date: new Date('2026-02-01'),
            },
        ])

        const res = await request(app)
            .get('/api/v1/income/filter')
            .query({ startDate: '2026-01-10', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data).toHaveLength(1)
        expect(res.body.data[0].title).toBe('Mid-month freelance')
    })

    it('returns 200 with empty array when no income matches', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/income/filter')
            .query({ startDate: '2026-06-01', endDate: '2026-06-30' })
            .set(authHeader(token))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data).toEqual([])
    })
})
