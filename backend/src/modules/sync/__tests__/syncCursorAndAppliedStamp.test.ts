import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { authHeader, registerUser, RegisteredUser } from '@tests/helpers'
import { SYNC_PULL_SAFETY_WINDOW_MS } from '../sync.service'

/**
 * BUG-60: `updatedAt` is stamped when the write is built and committed a little later, so a pull
 * can see a later-stamped write before an earlier-stamped one lands. The checkpoint a pull hands
 * back must therefore lag the newest doc by a safety window rather than sit on it.
 *
 * BUG-57: an applied create/update reports the `updatedAt` the server gave the row, which is what
 * the client rebases its still-queued edits of the same record onto.
 */

const seedAccountStampedAt = async (userId: string, name: string, updatedAt: Date) => {
    const account = await Account.create({
        userId,
        name,
        type: 'checking',
        currency: 'USD',
        openingBalance: 0,
        currentBalance: 0,
    })
    await Account.updateOne({ _id: account._id }, { $set: { updatedAt } }, { timestamps: false })
    return account
}

const pull = async (app: Application, owner: RegisteredUser, checkpoint: string, limit?: number) => {
    const res = await request(app)
        .get('/api/v1/sync/pull')
        .query({ checkpoint, ...(limit ? { limit } : {}) })
        .set(authHeader(owner.token))
    expect(res.status).toBe(200)
    return res.body.data as {
        changes: { entity: string; doc: { _id: string } }[]
        checkpoint: string
        hasMore: boolean
    }
}

const accountIds = (page: { changes: { entity: string; doc: { _id: string } }[] }): string[] =>
    page.changes.filter((change) => change.entity === 'account').map((change) => change.doc._id)

describe('Sync API - pull cursor safety window (BUG-60)', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('delivers a write that was stamped earlier than one already pulled but committed after that pull', async () => {
        const now = Date.now()
        const later = await seedAccountStampedAt(owner.userId, 'Stamped later, committed first', new Date(now - 500))

        const first = await pull(app, owner, '')
        expect(accountIds(first)).toContain(later._id.toString())

        const late = await seedAccountStampedAt(owner.userId, 'Stamped earlier, committed last', new Date(now - 1500))

        const second = await pull(app, owner, first.checkpoint)
        expect(accountIds(second)).toContain(late._id.toString())
    })

    it('the same holds for a checkpoint taken from the bootstrap snapshot', async () => {
        const now = Date.now()
        await seedAccountStampedAt(owner.userId, 'Already there', new Date(now - 500))

        const bootstrap = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))
        expect(bootstrap.status).toBe(200)

        const late = await seedAccountStampedAt(owner.userId, 'Committed after the snapshot', new Date(now - 1500))

        const page = await pull(app, owner, bootstrap.body.data.checkpoint)
        expect(accountIds(page)).toContain(late._id.toString())
    })

    it('does not keep re-delivering a doc once it is older than the safety window', async () => {
        const old = await seedAccountStampedAt(
            owner.userId,
            'Quiet for a while',
            new Date(Date.now() - SYNC_PULL_SAFETY_WINDOW_MS - 60_000)
        )

        const first = await pull(app, owner, '')
        expect(accountIds(first)).toContain(old._id.toString())

        const second = await pull(app, owner, first.checkpoint)
        expect(accountIds(second)).not.toContain(old._id.toString())
    })

    it('still pages to the end without repeats inside one sweep when every doc is recent', async () => {
        const now = Date.now()
        const created: string[] = []
        for (let i = 0; i < 5; i += 1) {
            const account = await seedAccountStampedAt(owner.userId, `Recent ${i}`, new Date(now - 4000 + i * 100))
            created.push(account._id.toString())
        }

        const seen = new Set<string>()
        let checkpoint = ''
        let hasMore = true
        let guard = 0
        while (hasMore && guard < 20) {
            guard += 1
            const page = await pull(app, owner, checkpoint, 2)
            for (const id of accountIds(page)) {
                expect(seen.has(id)).toBe(false)
                seen.add(id)
            }
            checkpoint = page.checkpoint
            hasMore = page.hasMore
        }

        expect(hasMore).toBe(false)
        for (const id of created) {
            expect(seen.has(id)).toBe(true)
        }
    })
})

describe('Sync API - push reports the server updatedAt (BUG-57)', () => {
    let app: Application
    let owner: RegisteredUser

    const push = async (op: Record<string, unknown>) => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [op] })
        expect(res.status).toBe(200)
        return res.body.data.results[0] as { status: string; resultId: string; updatedAt?: string }
    }

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('an applied create carries the stored updatedAt', async () => {
        const clientId = '65a1b2c3d4e5f6a7b8c9d0f1'
        const result = await push({
            opId: 'stamp-create-1',
            entity: 'account',
            operation: 'create',
            payload: { _id: clientId, name: 'Created', type: 'checking', openingBalance: 0 },
        })

        expect(result.status).toBe('applied')
        const stored = await Account.findById(clientId)
        expect(result.updatedAt).toBe(stored?.updatedAt.toISOString())
    })

    it('an applied update carries the stored updatedAt, and that value is accepted as the next base', async () => {
        const account = await seedAccountStampedAt(owner.userId, 'Original', new Date(Date.now() - 60_000))

        const first = await push({
            opId: 'stamp-update-1',
            entity: 'account',
            operation: 'update',
            baseUpdatedAt: account.updatedAt.toISOString(),
            payload: { _id: account._id.toString(), name: 'First edit' },
        })
        expect(first.status).toBe('applied')
        const afterFirst = await Account.findById(account._id)
        expect(first.updatedAt).toBe(afterFirst?.updatedAt.toISOString())

        const second = await push({
            opId: 'stamp-update-2',
            entity: 'account',
            operation: 'update',
            baseUpdatedAt: first.updatedAt,
            payload: { _id: account._id.toString(), name: 'Second edit' },
        })
        expect(second.status).toBe('applied')
        expect(second.updatedAt).not.toBe(first.updatedAt)
        expect((await Account.findById(account._id))?.name).toBe('Second edit')
    })

    it('a conflict does not carry an updatedAt', async () => {
        const account = await seedAccountStampedAt(owner.userId, 'Original', new Date(Date.now() - 60_000))

        const result = await push({
            opId: 'stamp-conflict-1',
            entity: 'account',
            operation: 'update',
            baseUpdatedAt: new Date(0).toISOString(),
            payload: { _id: account._id.toString(), name: 'Stale edit' },
        })

        expect(result.status).toBe('conflict')
        expect(result.updatedAt).toBeUndefined()
    })
})
