import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Notification } from '@modules/notifications'
import { Tag } from '@modules/tags'
import { User } from '@modules/users'
import { Workspace, WorkspaceInvite } from '@modules/workspaces'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, registerUser } from '@tests/helpers'
import { disableBilling, enableBilling, seedTestPlans } from '@tests/billingHelpers'

import { DEFAULT_DEMO_EMAIL, DEFAULT_DEMO_PASSWORD, seedDemoAccount } from '../demoAccount.service'

const NOW = new Date('2026-09-23T12:00:00.000Z')

const loginDemo = async () => {
    const agent = request.agent(app)
    const res = await agent.post('/api/v1/auth/login').send({ email: DEFAULT_DEMO_EMAIL, password: DEFAULT_DEMO_PASSWORD })
    return { agent, token: res.body.data.token as string, userId: res.body.data.user._id as string }
}

afterEach(() => disableBilling())

describe.each([
    ['billing off', () => disableBilling()],
    ['billing on', () => enableBilling()],
])('SEC-73 demo write guard (%s)', (_label, configureBilling) => {
    let demo: { agent: ReturnType<typeof request.agent>; token: string; userId: string }

    beforeEach(async () => {
        configureBilling()
        await seedTestPlans()
        await seedDemoAccount(NOW)
        demo = await loginDemo()
    })

    it('refuses deleting the account and leaves the user, data and sessions intact', async () => {
        const res = await request(app)
            .delete('/api/v1/auth/account')
            .set(authHeader(demo.token))
            .send({ password: DEFAULT_DEMO_PASSWORD })

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.DEMO_READ_ONLY)
        expect(await User.countDocuments({ email: DEFAULT_DEMO_EMAIL })).toBe(1)
        expect(await Account.countDocuments({ userId: demo.userId })).toBe(3)
    })

    it('refuses logout-all, so one visitor cannot sign the others out', async () => {
        const before = (await User.findById(demo.userId).lean())?.tokenVersion

        const res = await request(app).post('/api/v1/auth/logout-all').set(authHeader(demo.token))

        expect(res.status).toBe(403)
        expect((await User.findById(demo.userId).lean())?.tokenVersion).toBe(before)
    })

    it('refuses profile edits, including a currency change', async () => {
        const res = await request(app)
            .patch('/api/v1/auth/user')
            .set(authHeader(demo.token))
            .send({ fullName: 'Defaced', preferredCurrency: 'EUR' })

        expect(res.status).toBe(403)
        const user = await User.findById(demo.userId).lean()
        expect(user?.fullName).toBe('Corvale Demo')
        expect(user?.preferredCurrency).not.toBe('EUR')
    })

    it.each([
        ['post', '/api/v1/accounts'],
        ['post', '/api/v1/sync/push'],
        ['post', '/api/v1/billing/checkout'],
        ['post', '/api/v1/auth/legal/accept'],
        ['patch', '/api/v1/notifications/read-all'],
        ['post', '/api/v1/onboarding/replay'],
        ['post', '/api/v1/workspaces'],
    ] as const)('refuses %s %s', async (method, path) => {
        const res = await request(app)[method](path).set(authHeader(demo.token)).send({})

        expect(res.status).toBe(403)
        expect(res.body.message).toBe(ERROR_MESSAGES.AUTH.DEMO_READ_ONLY)
    })

    it.each([
        ['post', '/api/v1/dashboard/reports/query'],
        ['post', '/api/v1/dashboard/reports/generate'],
        ['post', '/api/v1/categorization-rules/test'],
        ['post', '/api/v1/debts/plan'],
        ['post', '/api/v1/imports/preview'],
    ] as const)('lets the read-only computation %s %s through', async (method, path) => {
        const res = await request(app)[method](path).set(authHeader(demo.token)).send({})

        expect(res.status).not.toBe(403)
        expect(res.status).not.toBe(402)
    })

    it('still serves every read', async () => {
        for (const path of ['/api/v1/accounts', '/api/v1/transactions', '/api/v1/auth/user', '/api/v1/sync/bootstrap']) {
            const res = await request(app).get(path).set(authHeader(demo.token))
            expect(res.status, path).toBe(200)
        }
    })

    it('still lets a visitor refresh and sign out', async () => {
        const refreshed = await demo.agent.post('/api/v1/auth/refresh')
        expect(refreshed.status).toBe(200)

        const loggedOut = await demo.agent.post('/api/v1/auth/logout')
        expect(loggedOut.status).toBe(200)
    })

    it('does not touch ordinary users', async () => {
        const user = await registerUser(app)

        const res = await request(app).patch('/api/v1/auth/user').set(authHeader(user.token)).send({ fullName: 'Renamed' })

        expect(res.status).toBe(200)
    })
})

describe('SEC-73 demo reseed resets every user-owned collection', () => {
    it('removes what a visitor left behind in categories, tags, notifications and workspace links', async () => {
        const first = await seedDemoAccount(NOW)
        const other = await registerUser(app)

        await Category.create({ userId: first.userId, name: 'Defaced category' })
        await Tag.create({ userId: first.userId, name: 'defaced' })
        await Notification.create({
            userId: first.userId,
            type: 'budget_over_limit',
            title: 'Junk',
            message: 'Junk',
            dedupeKey: 'junk',
        })
        const workspace = await Workspace.create({
            name: 'Attacker space',
            ownerId: other.userId,
            members: [
                { userId: other.userId, role: 'owner' },
                { userId: first.userId, role: 'editor' },
            ],
        })
        await WorkspaceInvite.create({
            workspaceId: workspace._id,
            inviterUserId: other.userId,
            inviteeUserId: first.userId,
            role: 'editor',
            status: 'pending',
        })

        const second = await seedDemoAccount(new Date(NOW.getTime() + 86_400_000))

        expect(second.userId).toBe(first.userId)
        expect(await Category.countDocuments({ userId: first.userId })).toBe(0)
        expect(await Tag.countDocuments({ userId: first.userId })).toBe(0)
        expect(await Notification.countDocuments({ userId: first.userId })).toBe(0)
        expect(await WorkspaceInvite.countDocuments({ inviteeUserId: first.userId })).toBe(0)
        const remaining = await Workspace.findById(workspace._id).lean()
        expect(remaining?.members.map((m) => m.userId.toString())).toEqual([other.userId])
    })
})
