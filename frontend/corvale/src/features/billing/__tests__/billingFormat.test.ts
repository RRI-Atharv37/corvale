import { describe, expect, it } from 'vitest'

import { READ_ONLY_ENTITLEMENTS } from '@lib/entitlements'
import { describeBilling, deviceLabel, formatBytes, formatUsd, whole, wholeDaysLeft, yearlySavingsPercent } from '../billingFormat'
import { LAPSED, daysFromNow, device, snapshot } from './fixtures'

const NOW = new Date()

describe('formatUsd', () => {
    it.each([
        [0, '$0'],
        [600, '$6'],
        [9600, '$96'],
        [1250, '$12.50'],
        [99, '$0.99'],
    ])('%i minor units -> %s', (minor, expected) => {
        expect(formatUsd(minor)).toBe(expected)
    })
})

describe('formatBytes', () => {
    it('states null as unlimited and rounds binary sizes the way the plan table does', () => {
        expect(formatBytes(null)).toBe('Unlimited')
        expect(formatBytes(1024 ** 3)).toBe('1 GB')
        expect(formatBytes(10 * 1024 ** 3)).toBe('10 GB')
        expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB')
        expect(formatBytes(0)).toBe('None')
    })
})

describe('wholeDaysLeft', () => {
    it('counts a started day as a day, and never goes negative', () => {
        expect(wholeDaysLeft(daysFromNow(3), NOW)).toBe(4)
        expect(wholeDaysLeft(new Date(NOW.getTime() + 60 * 1000).toISOString(), NOW)).toBe(1)
        expect(wholeDaysLeft(daysFromNow(-2), NOW)).toBe(0)
    })

    it('treats a missing or unreadable date as no time left', () => {
        expect(wholeDaysLeft(null, NOW)).toBe(0)
        expect(wholeDaysLeft('not a date', NOW)).toBe(0)
    })
})

describe('whole', () => {
    it('pluralises a day count', () => {
        expect(whole(1, 'day')).toBe('1 day')
        expect(whole(2, 'day')).toBe('2 days')
    })
})

describe('yearlySavingsPercent', () => {
    it('is the rounded discount of the annual price against twelve months', () => {
        expect(yearlySavingsPercent({ monthly: 1200, annual: 9600 })).toBe(33)
        expect(yearlySavingsPercent({ monthly: 600, annual: 6000 })).toBe(17)
    })

    it('is zero when annual is not cheaper', () => {
        expect(yearlySavingsPercent({ monthly: 500, annual: 6000 })).toBe(0)
    })
})

describe('describeBilling', () => {
    it('says nothing while billing is off', () => {
        expect(describeBilling(snapshot({ billingEnabled: false }), NOW)).toBeNull()
    })

    it('says nothing for a snapshot the client could not read', () => {
        expect(describeBilling(READ_ONLY_ENTITLEMENTS, NOW)).toBeNull()
    })

    it('says nothing for a healthy paid subscription', () => {
        expect(describeBilling(snapshot({ status: 'active' }), NOW)).toBeNull()
    })

    it('counts down a running trial and names the plan it includes', () => {
        const notice = describeBilling(snapshot({ status: 'trialing', planCode: 'pro', trialEndsAt: daysFromNow(9), currentPeriodEnd: null }), NOW)

        expect(notice).toMatchObject({ kind: 'trialing', tone: 'info', daysLeft: 10 })
        expect(notice?.title).toMatch(/10 days left/i)
        expect(notice?.message).toMatch(/pro/i)
    })

    it('turns urgent in the last three days of a trial', () => {
        const notice = describeBilling(snapshot({ status: 'trialing', trialEndsAt: daysFromNow(1), currentPeriodEnd: null }), NOW)

        expect(notice).toMatchObject({ kind: 'trialing', tone: 'warning' })
    })

    it('an expired trial is read-only, not gone: it says the data is safe and can be exported', () => {
        const notice = describeBilling(snapshot({ status: 'trial_expired', ...LAPSED, trialEndsAt: daysFromNow(-3) }), NOW)

        expect(notice).toMatchObject({ kind: 'trial-expired', tone: 'danger' })
        expect(notice?.message).toMatch(/read-only/i)
        expect(notice?.message).toMatch(/export/i)
    })

    it('a failed payment inside the grace window names the deadline while editing still works', () => {
        const notice = describeBilling(snapshot({ status: 'past_due', graceEndsAt: daysFromNow(4) }), NOW)

        expect(notice).toMatchObject({ kind: 'past-due', tone: 'warning' })
        expect(notice?.message).toMatch(/payment/i)
    })

    it('a failed payment past the grace window says editing is paused and nothing was deleted', () => {
        const notice = describeBilling(snapshot({ status: 'past_due', ...LAPSED, graceEndsAt: daysFromNow(-1) }), NOW)

        expect(notice).toMatchObject({ kind: 'access-paused', tone: 'danger' })
        expect(notice?.message).toMatch(/paused/i)
    })

    it('a subscription set to end says when, and that access continues until then', () => {
        const notice = describeBilling(snapshot({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: daysFromNow(12) }), NOW)

        expect(notice).toMatchObject({ kind: 'cancelling', tone: 'info' })
        expect(notice?.message).toMatch(/until then/i)
    })

    it('a cancelled subscription is read-only with an export reminder', () => {
        const notice = describeBilling(snapshot({ status: 'cancelled', ...LAPSED }), NOW)

        expect(notice).toMatchObject({ kind: 'cancelled', tone: 'danger' })
        expect(notice?.message).toMatch(/export/i)
    })

    it('an account with no plan at all is read-only until it picks one', () => {
        const notice = describeBilling(snapshot({ status: 'none', planCode: null, ...LAPSED, currentPeriodEnd: null }), NOW)

        expect(notice).toMatchObject({ kind: 'no-subscription' })
    })

    it('a grandfathered account that still writes is never nagged, whatever its stored status says', () => {
        expect(describeBilling(snapshot({ status: 'cancelled', canWrite: true }), NOW)).toBeNull()
        expect(describeBilling(snapshot({ status: 'trial_expired', canWrite: true }), NOW)).toBeNull()
    })
})

describe('deviceLabel', () => {
    it('prefers the name the user chose', () => {
        expect(deviceLabel(device({ name: 'Work laptop', kind: 'desktop' }))).toBe('Work laptop')
    })

    it.each([
        ['desktop', 'Desktop app'],
        ['web', 'Web browser'],
        ['pwa', 'Installed web app'],
    ] as const)('names an unnamed %s device %s', (kind, label) => {
        expect(deviceLabel(device({ name: null, kind }))).toBe(label)
    })

    it('calls the shared row of pre-identity clients an earlier app version', () => {
        expect(deviceLabel(device({ deviceId: '_legacy', kind: null, name: null }))).toBe('Earlier app version')
    })

    it('never shows a raw id: an unknown kind is just an unknown device', () => {
        expect(deviceLabel(device({ deviceId: 'a1b2c3', kind: null, name: null }))).toBe('Unknown device')
    })
})
