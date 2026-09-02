import { describe, it, expect } from 'vitest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Tag } from '@modules/tags'
import { Transaction } from '@modules/transactions'
import { QUERY_OPERATIONS } from '@core/access/rowLevelSecurityPlugin'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { registerUser } from './helpers'

const UNSCOPED = /missing user or workspace scope/i

const EXPECTED_HOOKED_OPERATIONS = [
    'countDocuments',
    'deleteMany',
    'deleteOne',
    'distinct',
    'estimatedDocumentCount',
    'find',
    'findOne',
    'findOneAndDelete',
    'findOneAndReplace',
    'findOneAndUpdate',
    'replaceOne',
    'updateMany',
    'updateOne',
]

/**
 * SEC-36 (S27) — the RLS plugin must hook every filter-bearing query operation, not just
 * the nine it originally covered. `updateOne` / `deleteOne` / `replaceOne` /
 * `findOneAndReplace` / `estimatedDocumentCount` were the gap.
 */
describe('SEC-36 — RLS hooked-operation coverage (S27)', () => {
    it('pins the exact set of hooked query operations so it cannot drift', () => {
        // If you are changing this list, you are changing the RLS guarantee — update the
        // CLAUDE.md RLS section and SECURITY.md alongside it.
        expect([...QUERY_OPERATIONS].sort()).toEqual([...EXPECTED_HOOKED_OPERATIONS].sort())
    })

    describe.each([
        ['updateOne', () => Tag.updateOne({ name: 'unscoped' }, { $set: { color: '#000000' } })],
        ['deleteOne', () => Tag.deleteOne({ name: 'unscoped' })],
        [
            'replaceOne',
            () => Tag.replaceOne({ name: 'unscoped' }, { name: 'x', userId: new Types.ObjectId() }),
        ],
        ['findOneAndReplace', () => Tag.findOneAndReplace({ name: 'unscoped' }, { name: 'x' })],
    ] as const)('%s is now guarded', (_op, runUnscoped) => {
        it('throws on an unscoped filter inside an authenticated request context', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(runUnscoped()).rejects.toThrow(UNSCOPED)
            })
        })

        it('is allowed with no RLS context active', async () => {
            await expect(runUnscoped()).resolves.toBeDefined()
        })
    })

    it('updateOne is allowed with a userId-scoped filter', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Tag.updateOne(
                    { userId: new Types.ObjectId(user.userId), name: 'scoped' },
                    { $set: { color: '#111111' } }
                )
            ).resolves.toBeDefined()
        })
    })

    it('deleteOne is allowed with a bare findById-style { _id } filter', async () => {
        const user = await registerUser(app)
        await runWithRlsContext({ userId: user.userId }, async () => {
            await expect(
                Transaction.deleteOne({ _id: new Types.ObjectId() })
            ).resolves.toBeDefined()
        })
    })

    describe('estimatedDocumentCount cannot be user-scoped', () => {
        it('is rejected while an RLS context is active', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(Tag.estimatedDocumentCount()).rejects.toThrow(UNSCOPED)
            })
        })

        it('works outside an RLS context', async () => {
            await expect(Tag.estimatedDocumentCount()).resolves.toBeTypeOf('number')
        })
    })
})
