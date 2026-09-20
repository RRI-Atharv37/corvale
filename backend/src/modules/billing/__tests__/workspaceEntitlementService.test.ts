import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Types } from 'mongoose'

import { Plan, Subscription, getWorkspaceEntitlements, getWorkspaceOwnerId } from '@modules/billing'
import { Workspace } from '@modules/workspaces'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { UNLIMITED_ENTITLEMENTS } from '@core/billing/entitlements'

/**
 * M2c - `getWorkspaceEntitlements` resolves a workspace's entitlements from its OWNER's subscription.
 * The HTTP-level behaviour (members, lapsed owners, borrowed scope) is pinned end to end in
 * tests/billing/workspaceEntitlements.test.ts once M4 wires the gates onto routes; this file pins
 * the service contract directly.
 */

const DAY = 24 * 60 * 60 * 1000

let ownerId: string
let memberId: string
let workspaceId: string

const subscribe = (userId: string, fields: Record<string, unknown> = {}) =>
    Subscription.create({
        userId,
        planCode: 'pro',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        ...fields,
    })

beforeEach(async () => {
    process.env.BILLING_ENABLED = 'true'
    await Plan.create([
        {
            code: 'plus',
            name: 'Plus',
            features: { workspaces: false, prioritySupport: false, bankSync: false },
            limits: { receiptStorageBytes: 100, syncDevices: 1, workspaceMembers: null },
        },
        {
            code: 'pro',
            name: 'Pro',
            features: { workspaces: true, prioritySupport: true, bankSync: true },
            limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: 3 },
        },
    ])

    ownerId = new Types.ObjectId().toString()
    memberId = new Types.ObjectId().toString()
    const workspace = await Workspace.create({
        name: 'Shared',
        ownerId,
        members: [
            { userId: ownerId, role: 'owner' },
            { userId: memberId, role: 'editor' },
        ],
    })
    workspaceId = workspace._id.toString()
})

afterEach(() => {
    delete process.env.BILLING_ENABLED
})

describe('getWorkspaceEntitlements', () => {
    it("resolves from the owner's subscription", async () => {
        await subscribe(ownerId, { planCode: 'pro' })

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.planCode).toBe('pro')
        expect(e.canWrite).toBe(true)
        expect(e.features.workspaces).toBe(true)
        expect(e.limits.workspaceMembers).toBe(3)
    })

    it("ignores a member's own subscription entirely", async () => {
        await subscribe(ownerId, { planCode: 'plus' })
        await subscribe(memberId, { planCode: 'pro' })

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.planCode).toBe('plus')
        expect(e.features.workspaces).toBe(false)
    })

    it('is unaffected by a member having no subscription at all', async () => {
        await subscribe(ownerId)

        expect((await getWorkspaceEntitlements(workspaceId)).canWrite).toBe(true)
    })

    it('an owner with no subscription row leaves the workspace read-only', async () => {
        await subscribe(memberId)

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.canWrite).toBe(false)
        expect(e.canRead).toBe(true)
        expect(e.canExport).toBe(true)
    })

    it('follows a lapsed owner into read-only', async () => {
        await subscribe(ownerId, { status: 'trial_expired', trialEndsAt: new Date(Date.now() - DAY) })

        const e = await getWorkspaceEntitlements(workspaceId)

        expect(e.status).toBe('trial_expired')
        expect(e.canWrite).toBe(false)
        expect(e.canRead).toBe(true)
        expect(e.canSyncPull).toBe(true)
        expect(e.canSyncPush).toBe(false)
    })

    it('a free_forever owner keeps a writable workspace whatever the stored status', async () => {
        await subscribe(ownerId, { status: 'cancelled', grandfatherKind: 'free_forever' })

        expect((await getWorkspaceEntitlements(workspaceId)).canWrite).toBe(true)
    })

    it('reads fresh state: the owner regaining a plan applies on the next call', async () => {
        await subscribe(ownerId, { status: 'cancelled', currentPeriodEnd: new Date(Date.now() - DAY) })
        expect((await getWorkspaceEntitlements(workspaceId)).canWrite).toBe(false)

        await Subscription.updateOne({ userId: ownerId }, { $set: { status: 'active', currentPeriodEnd: new Date(Date.now() + DAY) } })

        expect((await getWorkspaceEntitlements(workspaceId)).canWrite).toBe(true)
    })

    it('honours an injected clock', async () => {
        await subscribe(ownerId, { status: 'trialing', trialEndsAt: new Date(Date.now() + DAY) })

        expect((await getWorkspaceEntitlements(workspaceId)).canWrite).toBe(true)
        expect((await getWorkspaceEntitlements(workspaceId, new Date(Date.now() + 2 * DAY))).canWrite).toBe(false)
    })

    it('is unlimited while billing is off, without needing the workspace to exist', async () => {
        delete process.env.BILLING_ENABLED

        const e = await getWorkspaceEntitlements(new Types.ObjectId().toString())

        expect(e).toEqual(UNLIMITED_ENTITLEMENTS)
    })

    it('returns a copy, so a caller cannot mutate the shared unlimited constant', async () => {
        delete process.env.BILLING_ENABLED

        const e = await getWorkspaceEntitlements(workspaceId)
        e.canWrite = false

        expect(UNLIMITED_ENTITLEMENTS.canWrite).toBe(true)
    })

    it('an unknown workspace is a 404, never a silent read-only or unlimited result', async () => {
        await expect(getWorkspaceEntitlements(new Types.ObjectId().toString())).rejects.toMatchObject({
            statusCode: 404,
            message: ERROR_MESSAGES.WORKSPACE.WORKSPACE_NOT_FOUND,
        })
    })

    it('a malformed workspace id is a 404, not a cast error', async () => {
        const error = await getWorkspaceEntitlements('not-an-id').catch((e: unknown) => e)

        expect(error).toBeInstanceOf(CustomError)
        expect((error as CustomError).statusCode).toBe(404)
    })
})

describe('getWorkspaceOwnerId', () => {
    it('returns the owner as a string', async () => {
        expect(await getWorkspaceOwnerId(workspaceId)).toBe(ownerId)
    })

    it('is a 404 for an unknown or malformed workspace', async () => {
        await expect(getWorkspaceOwnerId(new Types.ObjectId().toString())).rejects.toMatchObject({ statusCode: 404 })
        await expect(getWorkspaceOwnerId('nope')).rejects.toMatchObject({ statusCode: 404 })
    })
})
