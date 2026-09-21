import type { NextFunction, Response } from 'express'
import mongoose, { Schema, Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    Plan,
    Subscription,
    requireScopedWriteAccess,
    scopeFromBody,
    scopeFromBodyResource,
    scopeFromBodyResources,
    scopeFromParam,
    scopeFromQuery,
    type BillingScope,
} from '@modules/billing'
import { Workspace } from '@modules/workspaces'
import type { AuthRequest } from '@http/middleware/authTypes'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * M4 - the resolvers and gate M4 wires onto the routes. A resolver must read exactly the field the
 * controller behind it reads: a gate that saw `body.workspaceId` while the controller only honoured
 * `query.workspaceId` would let a lapsed user borrow a workspace's plan for personal writes.
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
    expect(outcome.error).toBeInstanceOf(CustomError)
    expect(outcome.error?.statusCode).toBe(statusCode)
    expect(outcome.error?.message).toBe(message)
}

interface ProbeDoc {
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
}

const Probe = mongoose.model<ProbeDoc>(
    'BillingScopeResolverProbe',
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
let workspaceId: string

const asReq = (extras: Record<string, unknown>) => ({ params: {}, body: {}, query: {}, ...extras }) as unknown as AuthRequest

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
            limits: { receiptStorageBytes: 1000, syncDevices: null, workspaceMembers: null },
        },
    ])
    owner = new Types.ObjectId().toString()
    editor = new Types.ObjectId().toString()
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

describe('scopeFromBody', () => {
    it('reads the workspace from the body only', async () => {
        expect(await scopeFromBody(asReq({ body: { workspaceId } }))).toBe(workspaceId)
        expect(await scopeFromBody(asReq({ query: { workspaceId } }))).toBeNull()
    })

    it.each([[undefined], [null], ['']])('treats %s as personal scope', async (value) => {
        expect(await scopeFromBody(asReq({ body: { workspaceId: value } }))).toBeNull()
    })

    it('has no body at all is personal scope', async () => {
        expect(await scopeFromBody(asReq({ body: undefined }))).toBeNull()
    })

    it('rejects a malformed workspace id with 400', async () => {
        await expect(scopeFromBody(asReq({ body: { workspaceId: 'nope' } }))).rejects.toMatchObject({ statusCode: 400 })
        await expect(scopeFromBody(asReq({ body: { workspaceId: { $ne: null } } }))).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('scopeFromQuery', () => {
    it('reads the workspace from the query only', async () => {
        expect(await scopeFromQuery(asReq({ query: { workspaceId } }))).toBe(workspaceId)
        expect(await scopeFromQuery(asReq({ body: { workspaceId } }))).toBeNull()
    })

    it('rejects a malformed workspace id with 400', async () => {
        await expect(scopeFromQuery(asReq({ query: { workspaceId: 'nope' } }))).rejects.toMatchObject({ statusCode: 400 })
    })
})

describe('scopeFromParam', () => {
    it('returns the workspace named in the route, for the routes that manage a workspace itself', async () => {
        expect(await scopeFromParam()(asReq({ params: { workspaceId } }))).toBe(workspaceId)
        expect(await scopeFromParam('id')(asReq({ params: { id: workspaceId } }))).toBe(workspaceId)
    })

    it('has nothing to return when the param is absent', async () => {
        expect(await scopeFromParam()(asReq({}))).toBeNull()
    })

    it('ignores anything the body or query claims', async () => {
        expect(await scopeFromParam()(asReq({ body: { workspaceId }, query: { workspaceId } }))).toBeNull()
    })
})

describe('scopeFromBodyResource', () => {
    it("returns the workspace of the record a body field points at, not what the client says", async () => {
        const shared = await Probe.create({ userId: editor, workspaceId })
        const personal = await Probe.create({ userId: editor })

        const scope = scopeFromBodyResource(Probe, 'probeId')

        expect(await scope(asReq({ body: { probeId: shared._id.toString() } }))).toBe(workspaceId)
        expect(await scope(asReq({ body: { probeId: personal._id.toString(), workspaceId } }))).toBeNull()
    })

    it.each([['missing'], ['malformed'], ['unknown id'], ['non-string']])(
        'a %s value falls back to personal scope so the controller can answer',
        async (kind) => {
            const value =
                kind === 'missing'
                    ? undefined
                    : kind === 'malformed'
                      ? 'nope'
                      : kind === 'unknown id'
                        ? new Types.ObjectId().toString()
                        : { $ne: null }

            expect(await scopeFromBodyResource(Probe, 'probeId')(asReq({ body: { probeId: value } }))).toBeNull()
        }
    )
})

describe('scopeFromBodyResources - one scope for a whole list, every id verified', () => {
    const NOT_FOUND = 'Probe not found'
    const MIXED = 'Probes from different scopes cannot be changed together'
    const scope = scopeFromBodyResources(Probe, 'probeIds', { notFoundMessage: NOT_FOUND, mixedScopeMessage: MIXED, max: 5 })
    const idsOf = (...docs: Array<{ _id: Types.ObjectId }>) => docs.map((d) => d._id.toString())

    it('returns the workspace every listed record belongs to', async () => {
        const a = await Probe.create({ userId: editor, workspaceId })
        const b = await Probe.create({ userId: editor, workspaceId })

        expect(await scope(asReq({ body: { probeIds: idsOf(a, b) } }))).toBe(workspaceId)
    })

    it('returns personal scope when every listed record is personal, whatever workspace the client names', async () => {
        const a = await Probe.create({ userId: editor })
        const b = await Probe.create({ userId: editor })

        expect(await scope(asReq({ body: { probeIds: idsOf(a, b), workspaceId }, query: { workspaceId } }))).toBeNull()
    })

    it('refuses a list that mixes scopes, in either order, before anything is judged on a plan', async () => {
        const shared = await Probe.create({ userId: editor, workspaceId })
        const personal = await Probe.create({ userId: editor })

        for (const ids of [idsOf(shared, personal), idsOf(personal, shared)]) {
            await expect(scope(asReq({ body: { probeIds: ids } }))).rejects.toMatchObject({ statusCode: 400, message: MIXED })
        }
    })

    it('refuses a list that mixes two different workspaces', async () => {
        const otherWorkspace = (await Workspace.create({ name: 'Second', ownerId: owner, members: [{ userId: owner, role: 'owner' }] }))._id
        const a = await Probe.create({ userId: editor, workspaceId })
        const b = await Probe.create({ userId: editor, workspaceId: otherWorkspace })

        await expect(scope(asReq({ body: { probeIds: idsOf(a, b) } }))).rejects.toMatchObject({ statusCode: 400, message: MIXED })
    })

    it.each([
        ['an unknown id', () => new Types.ObjectId().toString()],
        ['a malformed id', () => 'nope'],
        ['a non-string id', () => ({ $ne: null })],
    ])('refuses a list containing %s as not found, even when the first id is fine', async (_label, bad) => {
        const good = await Probe.create({ userId: editor, workspaceId })

        await expect(scope(asReq({ body: { probeIds: [good._id.toString(), bad()] } }))).rejects.toMatchObject({
            statusCode: 404,
            message: NOT_FOUND,
        })
    })

    it('counts a repeated id once', async () => {
        const a = await Probe.create({ userId: editor, workspaceId })

        expect(await scope(asReq({ body: { probeIds: [a._id.toString(), a._id.toString()] } }))).toBe(workspaceId)
    })

    it.each([['missing', undefined], ['not a list', 'x'], ['empty', []], ['over the maximum', Array.from({ length: 6 }, () => new Types.ObjectId().toString())]])(
        'a %s list is left to the controller to reject, and costs no lookup',
        async (_label, value) => {
            expect(await scope(asReq({ body: { probeIds: value } }))).toBeNull()
        }
    )
})

describe('requireScopedWriteAccess(scope)', () => {
    const inWorkspace: BillingScope = () => workspaceId
    const personal: BillingScope = () => null

    it("a member writes to a Pro owner's workspace on no plan of their own", async () => {
        await subscribe(owner)

        expectAllowed(await run(editor, requireScopedWriteAccess(inWorkspace)))
    })

    it('a Plus owner cannot host workspace writes: ENTITLEMENT_REQUIRED, for the owner and the members', async () => {
        await subscribe(owner, { planCode: 'plus' })
        await subscribe(editor, { planCode: 'pro' })

        expectRefused(await run(editor, requireScopedWriteAccess(inWorkspace)), 402, ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
        expectRefused(await run(owner, requireScopedWriteAccess(inWorkspace)), 402, ERROR_MESSAGES.BILLING.ENTITLEMENT_REQUIRED)
    })

    it('a lapsed owner is READ_ONLY, reported before the missing feature', async () => {
        await subscribe(owner, { planCode: 'plus', ...LAPSED })

        expectRefused(await run(editor, requireScopedWriteAccess(inWorkspace)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('personal scope needs only write access, not the workspaces feature', async () => {
        await subscribe(editor, { planCode: 'plus' })

        expectAllowed(await run(editor, requireScopedWriteAccess(personal)))
    })

    it('personal scope on a lapsed plan is READ_ONLY whoever owns the workspaces the caller belongs to', async () => {
        await subscribe(owner)
        await subscribe(editor, LAPSED)

        expectRefused(await run(editor, requireScopedWriteAccess(personal)), 402, ERROR_MESSAGES.BILLING.READ_ONLY)
    })

    it('a non-member naming the workspace gets the membership 403 and learns nothing of the owner plan', async () => {
        await subscribe(owner, { planCode: 'plus' })

        expectRefused(await run(new Types.ObjectId().toString(), requireScopedWriteAccess(inWorkspace)), 403, ERROR_MESSAGES.WORKSPACE.NOT_A_MEMBER)
    })

    it('is a no-op while billing is off', async () => {
        delete process.env.BILLING_ENABLED
        await subscribe(owner, { planCode: 'plus', ...LAPSED })

        expectAllowed(await run(editor, requireScopedWriteAccess(inWorkspace)))
    })

    it('a free_forever owner on Pro never freezes the workspace', async () => {
        await subscribe(owner, { planCode: 'pro', ...LAPSED, grandfatherKind: 'free_forever' })

        expectAllowed(await run(editor, requireScopedWriteAccess(inWorkspace)))
    })
})
