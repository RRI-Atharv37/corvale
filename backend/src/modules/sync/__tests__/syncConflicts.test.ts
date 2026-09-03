import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { Category } from '@modules/categories'
import { Transaction } from '@modules/transactions'
import { SOFT_DELETE_BYPASS } from '@core/softDelete/softDelete'
import { registerUser, authHeader, ensureTimestampAdvances, RegisteredUser } from '@tests/helpers'

/**
 * Acceptance spec for sync conflict detection.
 * Contract (the "Conflicts" architecture decision):
 *   - Per-document last-write-wins with the SERVER as arbiter.
 *   - An `update`/`delete` op carries `baseUpdatedAt`; if it doesn't match
 *     the server doc's current `updatedAt`, the op comes back
 *     `status: 'conflict'` with `conflict.serverDoc` set to the current
 *     server state, and the client's mutation is NOT applied.
 *   - Money fields are never field-merged — a conflict is surfaced, not
 *     auto-resolved.
 *   - delete-vs-update: whichever ordering the ops arrive in, the delete
 *     always wins — the document ends up deleted (soft-deleted) and any
 *     update that raced against it is reported as a conflict.
 *   - A duplicate `create` (payload carries a client-generated `_id` that
 *     already exists for this entity/user) is a no-op: the existing
 *     document is left untouched and the op is reported without creating a
 *     second document.
 */

const seedAccount = async (userId: string) =>
    Account.create({
        userId,
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        openingBalance: 1000,
        currentBalance: 1000,
    })

const seedCategory = async (userId: string, name = 'Groceries') => Category.create({ userId, name })

describe('Sync API — conflict resolution', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('a stale baseUpdatedAt on update is reported as a conflict and does not mutate the doc', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Original title',
            date: new Date(),
        })
        const staleBaseUpdatedAt = transaction.updatedAt.toISOString()

        await ensureTimestampAdvances()
        transaction.title = 'Changed out from under the client'
        await transaction.save()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'stale-update-1',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Client wanted this title' },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('conflict')
        expect(res.body.data.results[0].conflict.serverDoc._id).toBe(transaction._id.toString())
        expect(res.body.data.results[0].conflict.serverDoc.title).toBe('Changed out from under the client')

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.title).toBe('Changed out from under the client')
    })

    it('never field-merges a money field on conflict — the server amount is untouched', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Amount conflict',
            date: new Date(),
        })
        const staleBaseUpdatedAt = transaction.updatedAt.toISOString()
        await ensureTimestampAdvances()
        transaction.amount = 9999
        await transaction.save()

        await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'stale-amount-1',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: transaction._id.toString(), amount: 100 },
                    },
                ],
            })

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.amount).toBe(9999)
    })

    it('delete wins over a racing update issued in the same push, update-then-delete order', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Delete vs update',
            date: new Date(),
        })
        const baseUpdatedAt = transaction.updatedAt.toISOString()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'race-update',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Racing update' },
                    },
                    {
                        opId: 'race-delete',
                        entity: 'transaction',
                        operation: 'delete',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString() },
                    },
                ],
            })

        expect(res.body.data.results[1].status).toBe('applied')

        const stored = await Transaction.findOne({ _id: transaction._id }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(stored?.deletedAt).toBeTruthy()
    })

    it('delete wins over a racing update issued delete-then-update, across two push calls', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Delete first',
            date: new Date(),
        })
        const baseUpdatedAt = transaction.updatedAt.toISOString()

        await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'delete-first',
                        entity: 'transaction',
                        operation: 'delete',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString() },
                    },
                ],
            })

        const updateRes = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'update-after-delete',
                        entity: 'transaction',
                        operation: 'update',
                        baseUpdatedAt,
                        payload: { _id: transaction._id.toString(), title: 'Too late' },
                    },
                ],
            })

        expect(updateRes.body.data.results[0].status).toBe('conflict')

        const stored = await Transaction.findOne({ _id: transaction._id }).setOptions({
            [SOFT_DELETE_BYPASS]: true,
        })
        expect(stored?.deletedAt).toBeTruthy()
        expect(stored?.title).toBe('Delete first')
    })

    it('a duplicate create with an already-used client-generated _id is a no-op, not a second document', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const clientId = '65a1b2c3d4e5f6a7b8c9d0e1'

        const first = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'dup-create-1',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            type: 'expense',
                            title: 'First device',
                            amount: 100,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        const duplicate = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'dup-create-2',
                        entity: 'transaction',
                        operation: 'create',
                        payload: {
                            _id: clientId,
                            type: 'expense',
                            title: 'Second device, same _id',
                            amount: 999,
                            date: new Date().toISOString(),
                            accountId: account._id.toString(),
                            categoryId: category._id.toString(),
                        },
                    },
                ],
            })

        expect(first.body.data.results[0].status).toBe('applied')
        expect(duplicate.body.data.results[0].status).toBe('noop')
        expect(duplicate.body.data.results[0].resultId).toBe(clientId)

        const count = await Transaction.countDocuments({ userId: owner.userId, _id: clientId })
        expect(count).toBe(1)
        const stored = await Transaction.findById(clientId)
        expect(stored?.title).toBe('First device')
    })
})

/**
 * BUG-16: the staleness check compares `baseUpdatedAt` against the server doc's
 * `updatedAt` as an exact ISO string (millisecond resolution). Two writes to one
 * document within the same millisecond — a second sync op, or a genuine
 * two-device race — used to leave `updatedAt` unchanged, so the second op's
 * "did this change out from under me?" check passed and the write was reported
 * `applied` instead of `conflict` (a silent lost update).
 *
 * The fix guarantees, server-side, that every `update` op applied through
 * /sync/push leaves the document's `updatedAt` STRICTLY greater than the value
 * the op was based on (an atomic compare-and-set claim on `updatedAt`, plus a
 * post-apply bump when the wall clock did not advance). No protocol change.
 */
describe('Sync API — BUG-16: same-millisecond concurrent writes', () => {
    let app: Application
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    const pushUpdate = (
        entity: string,
        opId: string,
        baseUpdatedAt: string,
        payload: Record<string, unknown>
    ) =>
        request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({ ops: [{ opId, entity, operation: 'update', baseUpdatedAt, payload }] })

    it('an applied account update advances updatedAt, so a second op on the old base conflicts', async () => {
        const account = await seedAccount(owner.userId)
        const base = account.updatedAt.toISOString()

        const first = await pushUpdate('account', 'bug16-acc-1', base, {
            _id: account._id.toString(),
            name: 'A',
        })
        expect(first.body.data.results[0].status).toBe('applied')

        const afterFirst = await Account.findById(account._id)
        expect(new Date(afterFirst!.updatedAt).getTime()).toBeGreaterThan(new Date(base).getTime())

        const second = await pushUpdate('account', 'bug16-acc-2', base, {
            _id: account._id.toString(),
            name: 'B',
        })
        expect(second.body.data.results[0].status).toBe('conflict')
        expect(second.body.data.results[0].conflict.serverDoc.name).toBe('A')

        const stored = await Account.findById(account._id)
        expect(stored?.name).toBe('A')
    })

    it('an applied transaction update advances updatedAt, so a second op on the old base conflicts', async () => {
        const account = await seedAccount(owner.userId)
        const category = await seedCategory(owner.userId)
        const transaction = await Transaction.create({
            userId: owner.userId,
            accountId: account._id,
            categoryId: category._id,
            type: 'expense',
            amount: 100,
            currency: 'USD',
            title: 'Base title',
            date: new Date(),
        })
        const base = transaction.updatedAt.toISOString()

        const first = await pushUpdate('transaction', 'bug16-txn-1', base, {
            _id: transaction._id.toString(),
            title: 'A',
        })
        expect(first.body.data.results[0].status).toBe('applied')

        const afterFirst = await Transaction.findById(transaction._id)
        expect(new Date(afterFirst!.updatedAt).getTime()).toBeGreaterThan(new Date(base).getTime())

        const second = await pushUpdate('transaction', 'bug16-txn-2', base, {
            _id: transaction._id.toString(),
            title: 'B',
        })
        expect(second.body.data.results[0].status).toBe('conflict')
        expect(second.body.data.results[0].conflict.serverDoc.title).toBe('A')

        const stored = await Transaction.findById(transaction._id)
        expect(stored?.title).toBe('A')
    })

    it('an applied category update advances updatedAt, so a second op on the old base conflicts', async () => {
        const category = await seedCategory(owner.userId, 'Base name')
        const base = category.updatedAt.toISOString()

        const first = await pushUpdate('category', 'bug16-cat-1', base, {
            _id: category._id.toString(),
            name: 'CatA',
        })
        expect(first.body.data.results[0].status).toBe('applied')

        const afterFirst = await Category.findById(category._id)
        expect(new Date(afterFirst!.updatedAt).getTime()).toBeGreaterThan(new Date(base).getTime())

        const second = await pushUpdate('category', 'bug16-cat-2', base, {
            _id: category._id.toString(),
            name: 'CatB',
        })
        expect(second.body.data.results[0].status).toBe('conflict')
        expect(second.body.data.results[0].conflict.serverDoc.name).toBe('CatA')

        const stored = await Category.findById(category._id)
        expect(stored?.name).toBe('CatA')
    })

    it('two concurrent pushes on the same doc/base resolve to exactly one applied + one conflict', async () => {
        const account = await seedAccount(owner.userId)
        let base = account.updatedAt.toISOString()

        for (let i = 0; i < 10; i++) {
            const opA = `race-a-${i}`
            const opB = `race-b-${i}`
            const nameA = `A${i}`
            const nameB = `B${i}`

            const [resA, resB] = await Promise.all([
                pushUpdate('account', opA, base, { _id: account._id.toString(), name: nameA }),
                pushUpdate('account', opB, base, { _id: account._id.toString(), name: nameB }),
            ])

            const results = [resA.body.data.results[0], resB.body.data.results[0]]
            const applied = results.filter((r) => r.status === 'applied')
            const conflicts = results.filter((r) => r.status === 'conflict')

            expect(applied).toHaveLength(1)
            expect(conflicts).toHaveLength(1)

            const winnerName = applied[0].opId === opA ? nameA : nameB
            const stored = await Account.findById(account._id)
            expect(stored?.name).toBe(winnerName)
            expect(new Date(stored!.updatedAt).getTime()).toBeGreaterThan(new Date(base).getTime())

            base = stored!.updatedAt.toISOString()
        }
    })

    it('a correctly-rebased follow-up update still applies (no false conflicts)', async () => {
        const account = await seedAccount(owner.userId)
        const base = account.updatedAt.toISOString()

        const first = await pushUpdate('account', 'rebased-1', base, {
            _id: account._id.toString(),
            name: 'First',
        })
        expect(first.body.data.results[0].status).toBe('applied')

        const afterFirst = await Account.findById(account._id)
        const rebased = afterFirst!.updatedAt.toISOString()

        const second = await pushUpdate('account', 'rebased-2', rebased, {
            _id: account._id.toString(),
            name: 'Second',
        })
        expect(second.body.data.results[0].status).toBe('applied')

        const stored = await Account.findById(account._id)
        expect(stored?.name).toBe('Second')
    })
})
