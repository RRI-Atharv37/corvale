import type { NextFunction, Response } from 'express'
import mongoose, { Schema, Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    Plan,
    Subscription,
    UsageCounter,
    requireEntitlement,
    requireQuota,
    requireWriteAccess,
    requireWriteAccessIn,
    scopeFromRequest,
    scopeFromResource,
    type BillingScope,
} from '@modules/billing'
import { Workspace } from '@modules/workspaces'
import type { AuthRequest } from '@http/middleware/authTypes'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * M2c - scope-aware gates. A write inside a workspace is judged on the workspace OWNER's
 * subscription; the scope comes from the target resource (by-id routes) or from an explicit
 * workspace field (creates, list-scoped and sync calls), and the caller must belong to the
 * workspace they name - a lapsed user cannot borrow a workspace's plan for personal data.
 */

const DAY = 24 * 60 * 60 * 1000

interface Outcome {
    nextCalled: boolean
    error: CustomError | null
}

const run = async (
    userId: string,
    middleware: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void> | void,
    reqExtras: Record<string, unknown> = {}
): Promise<Outcome> => {
    const outcome: Outcome = { nextCalled: false, error: null }
    const req = { user: { _id: new Types.ObjectId(userId) }, params: {}, body: {}, query: {}, ...reqExtras } as unknown as AuthRequest
    const next: NextFunction = (err?: unknown) => {
        outcome.nextCalled = true
        outcome.error = (err as CustomError | undefined) ?? null
    }
    await runWithRlsContext({ userId }, async () => {
        await middleware(req, {} as Response, next)
    })
    return outcome
}

const expectAllowed = (outcome: Outcome): void => {
    expect(outcome.nextCalled).toBe(true)
    expect(outcome.error).toBeNull()
}

const expectRefused = (outcome: Outcome, statusCode: number, message: string): void => {
    expect(outcome.nextCalled).toBe(true)
    expect(outcome.error).toBeInstanceOf(CustomError)
    expect(outcome.error?.statusCode).toBe(statusCode)
    expect(outcome.error?.message).toBe(message)
}

interface ProbeDoc {
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
}

const Probe = mongoose.model<ProbeDoc>(
    'BillingScopeProbe',
    new Schema<ProbeDoc>({
        userId: { type: Schema.Types.ObjectId, required: true },
        workspaceId: { type: Schema.Types.ObjectId, default: null },
    })
)

const subscribe = (userId: string, fields: Record<string, unknown> = {}) =>
    Subscription.create({
        userId,
        planCode: 'pro',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        ...fields,
    })

const LAPSED = { status: 'trial_expired', trialEndsAt: new Date(Date.now() - DAY) }

let owner: string
let editor: string
let stranger: string
let workspaceId: string

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

    owner = new Types.ObjectId().toString()
    editor = new Types.ObjectId().toString()
    stranger = new Types.ObjectId().toString()
    workspaceId = (
        await Workspace.create({
            name: 'Shared',
            ownerId: owner,
            members: [
                { userId: owner, role: 'owner' },
                { userId: editor, role: 'editor' },
            ],
        })
    )._id.toString()
})

afterEach(() => {
    delete process.env.BILLING_ENABLED
})

describe('scopeFromRequest', () => {
    const scopeOf = (extras: Record<string, unknown>) => scopeFromRequest({ params: {}, body: {}, query: {}, ...extras } as unknown as AuthRequest)

    it('reads the workspace from the body', async () => {
        expect(await scopeOf({ body: { workspaceId } })).toBe(workspaceId)
    })

    it('reads the workspace from the query', async () => {
        expect(await scopeOf({ query: { workspaceId } })).toBe(workspaceId)
    })

    it.each([[undefined], [null], ['']])('treats %s as personal scope', async (value) => {
        expect(await scopeOf({ body: { workspaceId: value } })).toBeNull()
    })

    it('no workspace field at all is personal scope', async () => {
        expect(await scopeOf({})).toBeNull()
    })

    it('rejects a malformed workspace id with 400', async () => {
        await expect(scopeOf({ body: { workspaceId: 'nope' } })).rejects.toMatchObject({ statusCode: 400 })
        await expect(scopeOf({ query: { workspaceId: { $ne: null } } })).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('scopeFromResource', () => {
    it("returns the stored resource's workspace", async () => {
        const doc = await Probe.create({ userId: editor, workspaceId })

        const scope = scopeFromResource(Probe)
        expect(await scope({ params: { id: doc._id.toString() } } as unknown as AuthRequest)).toBe(workspaceId)
    })

    it('returns null for a personal resource', async () => {
        const doc = await Probe.create({ userId: editor })

        expect(await scopeFromResource(Probe)({ params: { id: doc._id.toString() } } as unknown as AuthRequest)).toBeNull()
    })

    it('ignores a workspaceId the client puts in the query or body', async () => {
        const doc = await Probe.create({ userId: editor })

        const scope = scopeFromResource(Probe)
        const req = { params: { id: doc._id.toString() }, query: { workspaceId }, body: { workspaceId } }

        expect(await scope(req as unknown as AuthRequest)).toBeNull()
    })

    it('reads the id from a named param', async () => {
        const doc = await Probe.create({ userId: editor, workspaceId })

        const scope = scopeFromResource(Probe, 'probeId')
        expect(await scope({ params: { probeId: doc._id.toString() } } as unknown as AuthRequest)).toBe(workspaceId)
    })

    it.each([['missing', () => new Types.ObjectId().toString()], ['malformed', () => 'nope']])(
        'a %s resource falls back to personal scope so the controller can 404',
        async (_label, id) => {
            expect(await scopeFromResource(Probe)({ params: { id: id() } } as unknown as AuthRequest)).toBeNull()
        }
    )
})

describe('requireWriteAccessIn(scope)', () => {
    const inWorkspace: BillingScope = () => workspaceId
    const personal: BillingScope = () => null

    it("judges a workspace write on the owner's subscription, not the member's", async () => {
        await subscribe(owner)
        await subscribe(editor, LAPSED)

        expectAllowed(await run(editor, requireWriteAccessIn(inWorkspace)))
    })

    it('a member with no subscription row can write to a paying owner’s workspace', async () => {
        await subscribe(owner)

        expectAllowed(await run(editor, requireWriteAccessIn(inWorkspace)))
    })

    it('a lapsed owner freezes the workspace for a paying member', async () => {
        await subscribe(owner, LAPSED)
        await subscribe(editor)

        expectRefused(await run(editor, requireWriteAccessIn(inWorkspace)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('a lapsed owner cannot write to their own workspace', async () => {
        await subscribe(owner, LAPSED)

        expectRefused(await run(owner, requireWriteAccessIn(inWorkspace)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it("a lapsed owner does not touch a member's personal scope", async () => {
        await subscribe(owner, LAPSED)
        await subscribe(editor)

        expectAllowed(await run(editor, requireWriteAccessIn(personal)))
    })

    it("a lapsed member's personal scope stays read-only even inside a paying workspace", async () => {
        await subscribe(owner)
        await subscribe(editor, LAPSED)

        expectRefused(await run(editor, requireWriteAccessIn(personal)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('a non-member cannot use a workspace scope: 403, not a billing verdict', async () => {
        await subscribe(owner)
        await subscribe(stranger, LAPSED)

        expectRefused(await run(stranger, requireWriteAccessIn(inWorkspace)), 403, ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER)
    })

    it('a non-member naming a lapsed owner’s workspace learns nothing about its billing state', async () => {
        await subscribe(owner, LAPSED)

        expectRefused(await run(stranger, requireWriteAccessIn(inWorkspace)), 403, ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER)
    })

    it('an unknown workspace is 404', async () => {
        await subscribe(editor)

        const missing: BillingScope = () => new Types.ObjectId().toString()
        expectRefused(await run(editor, requireWriteAccessIn(missing)), 404, ERROR_MESSAGES.WORKSPACE.WORKSPACE_NOT_FOUND)
    })

    it('an async scope resolver is awaited', async () => {
        await subscribe(owner, LAPSED)

        expectRefused(
            await run(editor, requireWriteAccessIn(async () => workspaceId)),
            402,
            ERROR_MESSAGES.BILLING.READ_ONLY
        )
    })

    it('a failing scope resolver surfaces its error and never lets the request through', async () => {
        const boom: BillingScope = () => {
            throw new CustomError(ERROR_MESSAGES.WORKSPACE.INVALID_WORKSPACE_ID, 400)
        }

        expectRefused(await run(editor, requireWriteAccessIn(boom)), 400, ERROR_MESSAGES.WORKSPACE.INVALID_WORKSPACE_ID)
    })

    it('is a no-op while billing is off, and never resolves the scope', async () => {
        delete process.env.BILLING_ENABLED
        let resolved = false

        expectAllowed(
            await run(editor, requireWriteAccessIn(() => {
                resolved = true
                return workspaceId
            }))
        )
        expect(resolved).toBe(false)
    })

    it('reads fresh state: the owner regaining a plan unfreezes the workspace', async () => {
        await subscribe(owner, LAPSED)
        expectRefused(await run(editor, requireWriteAccessIn(inWorkspace)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)

        await Subscription.updateOne({ userId: owner }, { $set: { status: 'active', trialEndsAt: null } })

        expectAllowed(await run(editor, requireWriteAccessIn(inWorkspace)))
    })

    it('the unscoped requireWriteAccess is unchanged: personal, caller only', async () => {
        await subscribe(owner)
        await subscribe(editor, LAPSED)

        expectRefused(await run(editor, requireWriteAccess), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })
})

describe('requireEntitlement(feature, scope)', () => {
    const inWorkspace: BillingScope = () => workspaceId

    it("checks the feature on the owner's plan", async () => {
        await subscribe(owner, { planCode: 'plus' })
        await subscribe(editor, { planCode: 'pro' })

        expectRefused(
            await run(editor, requireEntitlement('workspaces', inWorkspace)),
            402,
            ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED
        )
    })

    it("a member on Plus is fine when the owner's plan has the feature", async () => {
        await subscribe(owner, { planCode: 'pro' })
        await subscribe(editor, { planCode: 'plus' })

        expectAllowed(await run(editor, requireEntitlement('workspaces', inWorkspace)))
    })

    it('without a scope it still resolves the caller', async () => {
        await subscribe(editor, { planCode: 'plus' })

        expectRefused(await run(editor, requireEntitlement('workspaces')), 402, ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
    })
})

describe('requireQuota(resource, amount, scope)', () => {
    const inWorkspace: BillingScope = () => workspaceId

    it("counts the owner's usage against the owner's limit", async () => {
        await subscribe(owner, { planCode: 'pro' })
        await UsageCounter.create({ userId: owner, resource: 'workspaceMembers', value: 3 })

        expectRefused(
            await run(owner, requireQuota('workspaceMembers', 1, inWorkspace)),
            402,
            ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED
        )
    })

    it("a member's own usage counter is not consulted for a workspace write", async () => {
        await subscribe(owner, { planCode: 'pro' })
        await UsageCounter.create({ userId: editor, resource: 'receiptBytes', value: 1_000_000 })

        expectAllowed(await run(editor, requireQuota('receiptBytes', 1, inWorkspace)))
    })

    it('without a scope it still counts the caller', async () => {
        await subscribe(editor, { planCode: 'plus' })
        await UsageCounter.create({ userId: editor, resource: 'receiptBytes', value: 100 })

        expectRefused(await run(editor, requireQuota('receiptBytes', 1)), 402, ERROR_MESSAGES.BILLING.QUOTA_EXCEEDED)
    })

    it('a lapsed owner is READ_ONLY before any quota is evaluated', async () => {
        await subscribe(owner, LAPSED)

        expectRefused(await run(editor, requireQuota('receiptBytes', 1, inWorkspace)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })
})
