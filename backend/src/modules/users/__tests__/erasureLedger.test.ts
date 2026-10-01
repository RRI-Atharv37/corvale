import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'

import app from '@http/app'
import { User } from '@modules/users'
import ErasureLedger from '@modules/users/erasureLedger.model'
import {
    ERASURE_LEDGER_RETENTION_DAYS,
    computeErasureId,
    recordErasure,
} from '@modules/users/erasureLedger.service'
import { replayErasures } from '@modules/users/erasureReplay.service'
import { deleteUserAccountCascade } from '@modules/users/accountDeletionUtils'
import { Account } from '@modules/accounts'
import { authHeader, registerUser } from '@tests/helpers'

/**
 * SEC-94 - a full disaster-recovery restore reinstates every account deleted since the dump, and
 * deletion left no record to re-apply. The ledger keeps a keyed hash of each erased id for the
 * backup window, and `replayErasures` re-erases whatever a restore brought back.
 */

const PASSWORD = 'LedgerTest123!'
const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => {
    delete process.env.ERASURE_LEDGER_KEY
})

describe('computeErasureId', () => {
    it('is deterministic and does not contain the user id', () => {
        const id = '64b7f0c2a1b2c3d4e5f60718'
        const hash = computeErasureId(id)

        expect(hash).toBe(computeErasureId(id))
        expect(hash).not.toContain(id)
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('depends on the configured key', () => {
        const id = '64b7f0c2a1b2c3d4e5f60718'
        process.env.ERASURE_LEDGER_KEY = 'key-one-key-one-key-one-key-one-0001'
        const first = computeErasureId(id)
        process.env.ERASURE_LEDGER_KEY = 'key-two-key-two-key-two-key-two-0002'

        expect(computeErasureId(id)).not.toBe(first)
    })
})

describe('recording an erasure', () => {
    it('DELETE /auth/account leaves a ledger row that holds a hash, never the user id', async () => {
        const { userId, token } = await registerUser(app, { email: 'ledger-record@example.com', password: PASSWORD })

        const res = await request(app).delete('/api/v1/auth/account').set(authHeader(token)).send({ password: PASSWORD })
        expect(res.status).toBe(200)

        const rows = await ErasureLedger.find({}).lean()
        expect(rows).toHaveLength(1)
        expect(rows[0].idHash).toBe(computeErasureId(userId))
        expect(JSON.stringify(rows[0])).not.toContain(userId)
    })

    it('expires the row after the backup window', async () => {
        await recordErasure('64b7f0c2a1b2c3d4e5f60718')

        const row = await ErasureLedger.findOne({}).lean()
        const lifetime = row!.expiresAt.getTime() - row!.erasedAt.getTime()
        expect(ERASURE_LEDGER_RETENTION_DAYS).toBe(30)
        expect(lifetime).toBe(ERASURE_LEDGER_RETENTION_DAYS * DAY_MS)
    })

    it('keeps the first erasure time when the same id is recorded again', async () => {
        await recordErasure('64b7f0c2a1b2c3d4e5f60718')
        const first = await ErasureLedger.findOne({}).lean()
        await recordErasure('64b7f0c2a1b2c3d4e5f60718')

        expect(await ErasureLedger.countDocuments({})).toBe(1)
        expect((await ErasureLedger.findOne({}).lean())!.erasedAt).toEqual(first!.erasedAt)
    })
})

describe('replayErasures after a restore', () => {
    const seedRestoredUser = async (email: string) => {
        const { userId } = await registerUser(app, { email, password: PASSWORD })
        await Account.create({ userId, name: 'Restored', type: 'checking', balance: 0, currency: 'USD' })
        return userId
    }

    it('erases the accounts the ledger lists and leaves the others alone', async () => {
        const erasedBeforeRestore = await seedRestoredUser('ledger-gone@example.com')
        const keeper = await seedRestoredUser('ledger-keeper@example.com')
        await recordErasure(erasedBeforeRestore)

        const result = await replayErasures()

        expect(result).toEqual({ matched: 1, erased: 1 })
        expect(await User.findById(erasedBeforeRestore)).toBeNull()
        expect(await Account.countDocuments({ userId: erasedBeforeRestore })).toBe(0)
        expect(await User.findById(keeper)).not.toBeNull()
        expect(await Account.countDocuments({ userId: keeper })).toBe(1)
    })

    it('reports without deleting on a dry run', async () => {
        const erasedBeforeRestore = await seedRestoredUser('ledger-dry@example.com')
        await recordErasure(erasedBeforeRestore)

        const result = await replayErasures({ dryRun: true })

        expect(result).toEqual({ matched: 1, erased: 0 })
        expect(await User.findById(erasedBeforeRestore)).not.toBeNull()
    })

    it('is a no-op with an empty ledger', async () => {
        const keeper = await seedRestoredUser('ledger-empty@example.com')

        expect(await replayErasures()).toEqual({ matched: 0, erased: 0 })
        expect(await User.findById(keeper)).not.toBeNull()
    })

    it('keeps the original erasure time when the cascade records the id again', async () => {
        const erasedBeforeRestore = await seedRestoredUser('ledger-keeptime@example.com')
        await recordErasure(erasedBeforeRestore)
        const before = await ErasureLedger.findOne({}).lean()

        await deleteUserAccountCascade(erasedBeforeRestore)

        expect(await ErasureLedger.countDocuments({})).toBe(1)
        expect((await ErasureLedger.findOne({}).lean())!.erasedAt).toEqual(before!.erasedAt)
    })
})
