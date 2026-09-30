import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { RecurringRule } from '@modules/recurring'
import { User } from '@modules/users'
import {
    startOfDayInTimezone,
    endOfDayInTimezone,
    dateStringInTimezone,
} from '@core/time/timezoneUtils'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { generateDraftsForRule } from '@modules/recurring/recurringRuleUtils'
import { projectRecurringOccurrences } from '@shared/forecast'
import { buildRecurringEvents } from '@shared/calendar'

// BUG-72 (S54): projectRecurringOccurrences and the forecast/calendar formatters hard-coded 'UTC',
// but rules store local midnight (18:30Z the previous day for IST). Projections started from the
// previous UTC date, hit the month-end overflow and labelled dates a day early.

const IST = 'Asia/Kolkata'
const NY = 'America/New_York'

const toDateStrings = (dates: Date[], timezone: string): string[] =>
    dates.map((d) => dateStringInTimezone(d, timezone))

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

describe('projectRecurringOccurrences - timezone aware (pure)', () => {
    it('projects an IST rule on the 1st onto the 1st of each month, February included', () => {
        const dates = projectRecurringOccurrences(
            { nextDueDate: startOfDayInTimezone('2026-10-01', IST), interval: 'monthly' },
            startOfDayInTimezone('2026-10-01', IST),
            endOfDayInTimezone('2027-03-31', IST),
            IST
        )

        expect(toDateStrings(dates, IST)).toEqual([
            '2026-10-01',
            '2026-11-01',
            '2026-12-01',
            '2027-01-01',
            '2027-02-01',
            '2027-03-01',
        ])
    })

    it('projects a New York rule from 31 October with November clamped and December back on the 31st', () => {
        const dates = projectRecurringOccurrences(
            {
                nextDueDate: startOfDayInTimezone('2026-10-31', NY),
                interval: 'monthly',
                anchorDay: 31,
            },
            startOfDayInTimezone('2026-10-31', NY),
            endOfDayInTimezone('2027-01-31', NY),
            NY
        )

        expect(toDateStrings(dates, NY)).toEqual([
            '2026-10-31',
            '2026-11-30',
            '2026-12-31',
            '2027-01-31',
        ])
    })

    it('defaults to UTC when no timezone is given', () => {
        const dates = projectRecurringOccurrences(
            { nextDueDate: new Date('2026-01-05T00:00:00.000Z'), interval: 'weekly' },
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-31T23:59:59.999Z')
        )
        expect(toDateStrings(dates, 'UTC')).toEqual([
            '2026-01-05',
            '2026-01-12',
            '2026-01-19',
            '2026-01-26',
        ])
    })
})

describe('calendar events - timezone aware (pure)', () => {
    it('labels IST recurring events on the local date', () => {
        const events = buildRecurringEvents(
            {
                id: 'r1',
                title: 'Rent',
                amount: 100000,
                accountId: 'a1',
                categoryId: 'c1',
                nextDueDate: startOfDayInTimezone('2026-10-01', IST),
                interval: 'monthly',
            },
            startOfDayInTimezone('2026-10-01', IST),
            endOfDayInTimezone('2026-12-31', IST),
            IST
        )

        expect(events.map((e) => e.date)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
    })
})

describe('forecast and calendar for an Asia/Kolkata rule on the 1st match draft generation', () => {
    it('GET /calendar lists the same dates that draft generation creates', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'tz-calendar-ist@example.com' })
        await User.findByIdAndUpdate(userId, { timezone: IST })
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
            nextDueDate: startOfDayInTimezone('2026-10-01', IST),
            isActive: true,
        })

        const res = await request(app)
            .get('/api/v1/calendar?start=2026-10-01&end=2027-03-31')
            .set(authHeader(token))
        expect(res.status).toBe(200)
        const calendarDates = res.body.data
            .filter((e: { type: string }) => e.type === 'recurring')
            .map((e: { date: string }) => e.date)

        expect(calendarDates).toEqual([
            '2026-10-01',
            '2026-11-01',
            '2026-12-01',
            '2027-01-01',
            '2027-02-01',
            '2027-03-01',
        ])

        const drafts = await generateDraftsForRule(
            rule,
            userId,
            endOfDayInTimezone('2027-03-31', IST),
            IST
        )
        expect(toDateStrings(drafts.map((d) => d.date), IST)).toEqual(calendarDates)
    })

    it('GET /forecast dates every projected occurrence on the 1st and starts on the local today', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'tz-forecast-ist@example.com' })
        await User.findByIdAndUpdate(userId, { timezone: IST })
        const account = await createTestAccount(token)
        const categoryId = await getFoodMasterId(token)

        const todayIst = dateStringInTimezone(new Date(), IST)
        const [year, month] = todayIst.split('-').map(Number)
        const nextFirst = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)

        await RecurringRule.create({
            userId,
            title: 'Rent',
            type: 'expense',
            amount: 120000,
            currency: 'USD',
            accountId: account._id,
            categoryId,
            interval: 'monthly',
            nextDueDate: startOfDayInTimezone(nextFirst, IST),
            isActive: true,
        })

        const res = await request(app).get('/api/v1/forecast?days=90').set(authHeader(token))
        expect(res.status).toBe(200)
        expect(res.body.data.startDate).toBe(todayIst)

        const recurringDates = res.body.data.accounts[0].projectedChanges
            .filter((c: { type: string }) => c.type === 'recurring')
            .map((c: { date: string }) => c.date)

        expect(recurringDates.length).toBeGreaterThanOrEqual(2)
        expect(recurringDates[0]).toBe(nextFirst)
        for (const date of recurringDates) {
            expect(date.endsWith('-01')).toBe(true)
        }
    })
})
