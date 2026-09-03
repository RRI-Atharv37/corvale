import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { RecurringRule } from '@modules/recurring'
import { Transaction } from '@modules/transactions'
import { startOfDayInTimezone, endOfDayInTimezone } from '@core/time/timezoneUtils'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { advanceNextDueDate, generateDraftsForRule } from "@modules/recurring/recurringRuleUtils";
import { resolveMonthlyPeriod } from "@modules/budgets/budgetUtils";

// BUG-06 (Gate G3, Sprint C6): advanceNextDueDate hardcodes the timezone to 'UTC' when advancing
// a recurring rule's nextDueDate, so the stored "local midnight" instant drifts by the DST delta
// the moment a rule crosses a transition. This suite is the acceptance spec for the fix: threading
// the real `User.timezone` through advanceNextDueDate (and the draft-generation duplicate-detection
// window) so every advance lands back on local midnight, in both a northern- and a southern-
// hemisphere zone, per BUGS.md's recommended fix. `timezone` is added as an optional 4th parameter
// (default 'UTC') so existing UTC-only call sites are unaffected.
//
// 2026 DST transition dates used below (verified against the standard US/Australia rules):
//   America/New_York: DST starts Sun 2026-03-08, ends Sun 2026-11-01
//   Australia/Sydney:  DST starts Sun 2026-10-04, ends Sun 2026-04-05

async function createTestAccount(token: string, name = 'Checking') {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance: 1000 })
    return res.body.data
}

async function getFoodMasterId(token: string): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const food = res.body.data.masters.find((m: { name: string }) => m.name === 'Food')
    if (!food) throw new Error('Food master category not found')
    return food._id
}

describe('advanceNextDueDate - DST boundary correctness (pure function)', () => {
    it('advances a monthly rule across the northern-hemisphere spring-forward boundary (America/New_York, Mar 8 2026)', () => {
        const current = startOfDayInTimezone('2026-03-01', 'America/New_York')
        const next = advanceNextDueDate(current, 'monthly', undefined, 'America/New_York')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-04-01', 'America/New_York').getTime())
    })

    it('advances a weekly rule across the exact spring-forward day (America/New_York, Mar 8 2026)', () => {
        const current = startOfDayInTimezone('2026-03-07', 'America/New_York')
        const next = advanceNextDueDate(current, 'weekly', undefined, 'America/New_York')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-03-14', 'America/New_York').getTime())
    })

    it('advances a monthly rule across the northern-hemisphere fall-back boundary (America/New_York, Nov 1 2026)', () => {
        const current = startOfDayInTimezone('2026-10-01', 'America/New_York')
        const next = advanceNextDueDate(current, 'monthly', undefined, 'America/New_York')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-11-01', 'America/New_York').getTime())
    })

    it('advances a monthly rule across the southern-hemisphere spring-forward boundary (Australia/Sydney, Oct 4 2026)', () => {
        const current = startOfDayInTimezone('2026-09-01', 'Australia/Sydney')
        const next = advanceNextDueDate(current, 'monthly', undefined, 'Australia/Sydney')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-10-01', 'Australia/Sydney').getTime())
    })

    it('advances a monthly rule across the southern-hemisphere fall-back boundary (Australia/Sydney, Apr 5 2026)', () => {
        const current = startOfDayInTimezone('2026-03-01', 'Australia/Sydney')
        const next = advanceNextDueDate(current, 'monthly', undefined, 'Australia/Sydney')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-04-01', 'Australia/Sydney').getTime())
    })

    it('advances a custom-interval rule across a DST boundary', () => {
        const current = startOfDayInTimezone('2026-03-01', 'America/New_York')
        const next = advanceNextDueDate(current, 'custom', 10, 'America/New_York')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-03-11', 'America/New_York').getTime())
    })

    it('defaults to UTC-calendar advancement when no timezone is passed, preserving existing callers', () => {
        const current = startOfDayInTimezone('2026-01-15', 'UTC')
        const next = advanceNextDueDate(current, 'monthly')

        expect(next.getTime()).toBe(startOfDayInTimezone('2026-02-15', 'UTC').getTime())
    })
})

describe('generateDraftsForRule - DST boundary correctness (integration)', () => {
    it('generates one draft per month, each landing on local midnight, across a spring-forward boundary', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'dst-drafts-spring@example.com' })
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
            nextDueDate: startOfDayInTimezone('2026-02-01', 'America/New_York'),
            isActive: true,
        })

        // Far enough ahead to cross the Mar 8 2026 DST boundary twice (Feb -> Mar -> Apr).
        const endOfToday = endOfDayInTimezone('2026-04-01', 'America/New_York')
        const drafts = await generateDraftsForRule(rule, userId, endOfToday, 'America/New_York')

        expect(drafts).toHaveLength(3)
        expect(drafts.map((d) => d.date.getTime())).toEqual([
            startOfDayInTimezone('2026-02-01', 'America/New_York').getTime(),
            startOfDayInTimezone('2026-03-01', 'America/New_York').getTime(),
            startOfDayInTimezone('2026-04-01', 'America/New_York').getTime(),
        ])

        const updatedRule = await RecurringRule.findById(rule._id)
        expect(updatedRule?.nextDueDate.getTime()).toBe(
            startOfDayInTimezone('2026-05-01', 'America/New_York').getTime()
        )
    })

    it('does not generate a duplicate or skip a draft when re-run across the same DST boundary', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'dst-drafts-dedupe@example.com' })
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
            nextDueDate: startOfDayInTimezone('2026-02-01', 'America/New_York'),
            isActive: true,
        })

        const endOfToday = endOfDayInTimezone('2026-04-01', 'America/New_York')
        await generateDraftsForRule(rule, userId, endOfToday, 'America/New_York')

        // Re-fetch (generateDraftsForRule mutates and saves nextDueDate) and re-run for the same window.
        const reloaded = await RecurringRule.findById(rule._id)
        const secondRun = await generateDraftsForRule(reloaded!, userId, endOfToday, 'America/New_York')
        expect(secondRun).toHaveLength(0)

        const allDrafts = await Transaction.find({ userId, recurringPaymentId: rule._id })
        expect(allDrafts).toHaveLength(3)
    })

    it('a rule advanced across a DST boundary still lands inside the timezone-correct budget period for the new month', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'dst-budget-boundary@example.com' })
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
            nextDueDate: startOfDayInTimezone('2026-03-01', 'America/New_York'),
            isActive: true,
        })

        // April 2026 budget period, computed independently and timezone-aware - the same way
        // resolveMonthlyPeriod already does today (BUG-06's "budget period boundaries" half).
        const aprilPeriod = resolveMonthlyPeriod(2026, 4, 'America/New_York')

        const endOfToday = endOfDayInTimezone('2026-04-01', 'America/New_York')
        const drafts = await generateDraftsForRule(rule, userId, endOfToday, 'America/New_York')

        const aprilDraft = drafts.find(
            (d) => d.date.getTime() === startOfDayInTimezone('2026-04-01', 'America/New_York').getTime()
        )
        expect(aprilDraft).toBeDefined()
        expect(aprilDraft!.date.getTime()).toBeGreaterThanOrEqual(aprilPeriod.periodStart.getTime())
        expect(aprilDraft!.date.getTime()).toBeLessThanOrEqual(aprilPeriod.periodEnd.getTime())
    })
})
