import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { RecurringRule } from '@modules/recurring'
import { startOfDayInTimezone, endOfDayInTimezone, dateStringInTimezone } from '@core/time/timezoneUtils'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import {
    advanceNextDueDate,
    endOfTodayInTimezone,
    generateDraftsForRule,
} from '@modules/recurring/recurringRuleUtils'
import { createRecurringRuleForOp } from '@modules/sync/recurringRuleSync.service'
import type { RecurringInterval } from '@modules/recurring/recurringRule.model'

// BUG-71 (S54): advanceNextDueDate added months with setUTCMonth on the due day, so a rule on the
// 29th-31st rolled over into the month after next and then drifted to the new day for good. The fix
// clamps to the last day of the target month and keeps the original day as `anchorDay` so the rule
// returns to it. BUG-72 (S54): the recurring "today" was the UTC date, not the user's.

const walk = (
    start: string,
    interval: RecurringInterval,
    steps: number,
    timezone = 'UTC',
    anchorDay?: number
): string[] => {
    let current = startOfDayInTimezone(start, timezone)
    const dates = [start]
    for (let i = 0; i < steps; i += 1) {
        current = advanceNextDueDate(current, interval, undefined, timezone, anchorDay)
        dates.push(dateStringInTimezone(current, timezone))
    }
    return dates
}

async function createTestAccount(token: string) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Checking', type: 'checking', openingBalance: 1000 })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
}

describe('advanceNextDueDate - month-end clamping (pure function)', () => {
    it('keeps a 31 January monthly rule in every month and returns to the 31st', () => {
        expect(walk('2026-01-31', 'monthly', 5, 'UTC', 31)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
            '2026-05-31',
            '2026-06-30',
        ])
    })

    it('keeps a 30 January monthly rule in February and returns to the 30th', () => {
        expect(walk('2026-01-30', 'monthly', 4, 'UTC', 30)).toEqual([
            '2026-01-30',
            '2026-02-28',
            '2026-03-30',
            '2026-04-30',
            '2026-05-30',
        ])
    })

    it('keeps a 29 January monthly rule in February (common year) and returns to the 29th', () => {
        expect(walk('2026-01-29', 'monthly', 3, 'UTC', 29)).toEqual([
            '2026-01-29',
            '2026-02-28',
            '2026-03-29',
            '2026-04-29',
        ])
    })

    it('lands a 29 January rule on 29 February in a leap year', () => {
        expect(walk('2028-01-29', 'monthly', 2, 'UTC', 29)).toEqual([
            '2028-01-29',
            '2028-02-29',
            '2028-03-29',
        ])
    })

    it('keeps a 31 August monthly rule in September and returns to the 31st', () => {
        expect(walk('2026-08-31', 'monthly', 4, 'UTC', 31)).toEqual([
            '2026-08-31',
            '2026-09-30',
            '2026-10-31',
            '2026-11-30',
            '2026-12-31',
        ])
    })

    it('clamps without an explicit anchor, using the day of the current date', () => {
        expect(walk('2026-01-31', 'monthly', 1)).toEqual(['2026-01-31', '2026-02-28'])
        expect(walk('2026-08-31', 'monthly', 1)).toEqual(['2026-08-31', '2026-09-30'])
    })

    it('clamps a quarterly rule and returns to the anchor day', () => {
        expect(walk('2026-01-31', 'quarterly', 3, 'UTC', 31)).toEqual([
            '2026-01-31',
            '2026-04-30',
            '2026-07-31',
            '2026-10-31',
        ])
    })

    it('moves a 29 February yearly rule to 28 February and back to 29 February in the next leap year', () => {
        expect(walk('2028-02-29', 'yearly', 4, 'UTC', 29)).toEqual([
            '2028-02-29',
            '2029-02-28',
            '2030-02-28',
            '2031-02-28',
            '2032-02-29',
        ])
    })

    it('clamps in a timezone east of UTC and lands on local midnight', () => {
        const next = advanceNextDueDate(
            startOfDayInTimezone('2026-01-31', 'Asia/Kolkata'),
            'monthly',
            undefined,
            'Asia/Kolkata',
            31
        )
        expect(next.getTime()).toBe(startOfDayInTimezone('2026-02-28', 'Asia/Kolkata').getTime())
    })

    it('does not change non-month intervals when an anchor day is supplied', () => {
        expect(walk('2026-01-31', 'weekly', 1, 'UTC', 31)).toEqual(['2026-01-31', '2026-02-07'])
        expect(walk('2026-01-31', 'daily', 1, 'UTC', 31)).toEqual(['2026-01-31', '2026-02-01'])
    })
})

describe('generateDraftsForRule - month-end anchor (integration)', () => {
    it('generates a draft in every month for a 31st rule and ends up on the next 30th/31st', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'month-end-anchor@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const rule = await RecurringRule.create({
            userId,
            title: 'Rent',
            type: 'expense',
            amount: 120000,
            currency: 'USD',
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: startOfDayInTimezone('2026-01-31', 'UTC'),
            anchorDay: 31,
            isActive: true,
        })

        const drafts = await generateDraftsForRule(
            rule,
            userId,
            endOfDayInTimezone('2026-04-01', 'UTC'),
            'UTC'
        )

        expect(drafts.map((d) => dateStringInTimezone(d.date, 'UTC'))).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
        ])

        const reloaded = await RecurringRule.findById(rule._id)
        expect(dateStringInTimezone(reloaded!.nextDueDate, 'UTC')).toBe('2026-04-30')
        expect(reloaded!.anchorDay).toBe(31)
    })

    it('still produces a February draft for a legacy rule with no stored anchor day', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'month-end-legacy@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const rule = await RecurringRule.create({
            userId,
            title: 'Rent',
            type: 'expense',
            amount: 120000,
            currency: 'USD',
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: startOfDayInTimezone('2026-01-31', 'UTC'),
            isActive: true,
        })

        const drafts = await generateDraftsForRule(
            rule,
            userId,
            endOfDayInTimezone('2026-03-01', 'UTC'),
            'UTC'
        )

        expect(drafts.map((d) => dateStringInTimezone(d.date, 'UTC'))).toEqual([
            '2026-01-31',
            '2026-02-28',
        ])
    })
})

describe('recurring rule anchorDay lifecycle', () => {
    it('sets anchorDay from nextDueDate on create', async () => {
        const { token } = await seedUserDirectly({ email: 'anchor-create@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const res = await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(token))
            .send({
                title: 'Salary',
                type: 'income',
                amount: 500,
                accountId: account._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-01-31',
            })

        expect(res.status).toBe(201)
        expect(res.body.data.anchorDay).toBe(31)
    })

    it('keeps the anchor when an unrelated field is edited and re-anchors when the due date is changed', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'anchor-update@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const created = await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(token))
            .send({
                title: 'Salary',
                type: 'income',
                amount: 500,
                accountId: account._id,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-01-31',
            })
        const ruleId = created.body.data._id

        await RecurringRule.updateOne(
            { _id: ruleId, userId },
            { $set: { nextDueDate: startOfDayInTimezone('2026-02-28', 'UTC') } }
        )

        const renamed = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))
            .send({ title: 'Pay', nextDueDate: '2026-02-28' })
        expect(renamed.status).toBe(200)
        expect(renamed.body.data.anchorDay).toBe(31)

        const moved = await request(app)
            .put(`/api/v1/recurring-rules/${ruleId}`)
            .set(authHeader(token))
            .send({ nextDueDate: '2026-03-15' })
        expect(moved.status).toBe(200)
        expect(moved.body.data.anchorDay).toBe(15)
    })

    it('sets anchorDay on a sync-created rule', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'anchor-sync@example.com' })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const rule = await createRecurringRuleForOp(userId, {
            title: 'Rent',
            type: 'expense',
            amount: 120000,
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: '2026-08-31',
        })

        expect(rule.anchorDay).toBe(31)
    })
})

describe('endOfTodayInTimezone - the recurring "today" follows the user timezone', () => {
    it('is already the next day in Asia/Kolkata just after local midnight', () => {
        const now = new Date('2026-03-31T18:45:00.000Z')
        expect(endOfTodayInTimezone('Asia/Kolkata', now).getTime()).toBe(
            endOfDayInTimezone('2026-04-01', 'Asia/Kolkata').getTime()
        )
        expect(endOfTodayInTimezone('UTC', now).getTime()).toBe(
            endOfDayInTimezone('2026-03-31', 'UTC').getTime()
        )
    })

    it('is still the same day in America/New_York in the evening, after UTC has rolled over', () => {
        const now = new Date('2026-04-01T01:30:00.000Z')
        expect(endOfTodayInTimezone('America/New_York', now).getTime()).toBe(
            endOfDayInTimezone('2026-03-31', 'America/New_York').getTime()
        )
    })
})
