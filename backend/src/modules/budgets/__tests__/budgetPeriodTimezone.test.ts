import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { User } from '@modules/users'
import { dateStringInTimezone, endOfDayInTimezone, startOfDayInTimezone } from '@core/time/timezoneUtils'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { createBudgetForOp, updateBudgetForOp } from '@modules/sync/budgetSync.service'

// BUG-72 (S54): a partial custom-period edit re-derived the untouched bound with
// `toISOString().slice(0, 10)`. For a timezone east of UTC the stored start (local midnight) is
// the previous UTC date, so every end-date-only edit moved the start back one more day.

const IST = 'Asia/Kolkata'
const NY = 'America/New_York'

describe('custom budget partial edits keep the untouched bound', () => {
    it('keeps an IST start across three end-date-only edits over REST', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'budget-tz-rest-ist@example.com' })
        await User.findByIdAndUpdate(userId, { timezone: IST })

        const created = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'custom',
                periodStart: '2026-10-01',
                periodEnd: '2026-10-31',
                amount: 150,
            })
        expect(created.status).toBe(201)
        const budgetId = created.body.data._id

        for (const end of ['2026-10-30', '2026-10-29', '2026-10-28']) {
            const res = await request(app)
                .put(`/api/v1/budgets/${budgetId}`)
                .set(authHeader(token))
                .send({ periodEnd: end })
            expect(res.status).toBe(200)
            expect(dateStringInTimezone(new Date(res.body.data.periodStart), IST)).toBe('2026-10-01')
            expect(dateStringInTimezone(new Date(res.body.data.periodEnd), IST)).toBe(end)
        }
    })

    it('keeps the end across a start-date-only edit for a timezone west of UTC', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'budget-tz-rest-ny@example.com' })
        await User.findByIdAndUpdate(userId, { timezone: NY })

        const created = await request(app)
            .post('/api/v1/budgets')
            .set(authHeader(token))
            .send({
                periodType: 'custom',
                periodStart: '2026-10-01',
                periodEnd: '2026-10-31',
                amount: 150,
            })
        const budgetId = created.body.data._id

        for (const start of ['2026-10-02', '2026-10-03']) {
            const res = await request(app)
                .put(`/api/v1/budgets/${budgetId}`)
                .set(authHeader(token))
                .send({ periodStart: start })
            expect(res.status).toBe(200)
            expect(dateStringInTimezone(new Date(res.body.data.periodStart), NY)).toBe(start)
            expect(dateStringInTimezone(new Date(res.body.data.periodEnd), NY)).toBe('2026-10-31')
        }
    })

    it('keeps an IST start across end-date-only edits through the sync push path', async () => {
        const { userId } = await seedUserDirectly({ email: 'budget-tz-sync-ist@example.com' })
        await User.findByIdAndUpdate(userId, { timezone: IST })

        const budget = await createBudgetForOp(userId, {
            periodType: 'custom',
            periodStart: startOfDayInTimezone('2026-10-01', IST).toISOString(),
            periodEnd: endOfDayInTimezone('2026-10-31', IST).toISOString(),
            amount: 15000,
        })

        for (const end of ['2026-10-30', '2026-10-29', '2026-10-28']) {
            const updated = await updateBudgetForOp(userId, { _id: budget._id.toString(), periodEnd: end })
            expect(dateStringInTimezone(updated.periodStart, IST)).toBe('2026-10-01')
            expect(dateStringInTimezone(updated.periodEnd, IST)).toBe(end)
        }
    })
})
