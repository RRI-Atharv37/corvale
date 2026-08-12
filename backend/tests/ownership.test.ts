import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Expense from '../models/Expense'
import Income from '../models/Income'
import { authHeader, registerUser, createSecondUser } from './helpers'

describe('Ownership enforcement', () => {
    it('returns 403 when accessing another user expense', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const expense = await Expense.create({
            userId: owner.userId,
            title: 'Owner expense',
            amount: 50,
            category: 'Food',
            date: new Date(),
        })

        const res = await request(app)
            .get(`/api/v1/expense/${expense._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })

    it('returns 403 when accessing another user income', async () => {
        const owner = await registerUser(app)
        const other = await createSecondUser(app)

        const income = await Income.create({
            userId: owner.userId,
            title: 'Owner income',
            amount: 1000,
            date: new Date(),
        })

        const res = await request(app)
            .get(`/api/v1/income/${income._id}`)
            .set(authHeader(other.token))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.message).toMatch(/not authorized/i)
    })
})
