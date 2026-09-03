import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { authHeader, registerUser } from '@tests/helpers'

describe('Expense route matching', () => {
    it('does not shadow static paths with :expenseId param', async () => {
        const { token } = await registerUser(app)

        const filterRes = await request(app)
            .get('/api/v1/expense/filter')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(filterRes.status).toBe(200)
        expect(Array.isArray(filterRes.body.data)).toBe(true)

        const searchRes = await request(app)
            .get('/api/v1/expense/search')
            .query({ keyword: 'coffee' })
            .set(authHeader(token))

        expect(searchRes.status).toBe(200)
        expect(Array.isArray(searchRes.body.data)).toBe(true)

        const groupRes = await request(app)
            .get('/api/v1/expense/group-by-category')
            .set(authHeader(token))

        expect(groupRes.status).toBe(200)
        expect(Array.isArray(groupRes.body.data)).toBe(true)

        const reportRes = await request(app)
            .get('/api/v1/expense/report')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' })
            .set(authHeader(token))

        expect(reportRes.status).toBe(200)
        expect(reportRes.body.data).toHaveProperty('expenses')
    })

    it('returns 404 for non-existent expense id route (not static path confusion)', async () => {
        const { token } = await registerUser(app)

        const res = await request(app)
            .get('/api/v1/expense/507f1f77bcf86cd799439011')
            .set(authHeader(token))

        expect(res.status).toBe(404)
        expect(res.body.success).toBe(false)
    })
})
