import request from 'supertest'
import { Application } from 'express'
import { createApp } from '../app'
import Account from '../models/Account'
import { migrateAccountBalancesToMinorUnits } from '../utils/migrateAccountBalancesToMinorUnits'
import { authHeader, ensureTimestampAdvances, registerUser, RegisteredUser } from './helpers'

/**
 * BUG-17 regression: `migrate:account-balances` converts
 * `Account.openingBalance`/`currentBalance` to integer minor units in Mongo,
 * but the local-first engine (`frontend/corvale/src/domain/*`) assumes
 * major-unit account balances everywhere. If the `/sync` wire format passed the
 * stored value through untouched, a migrated account would sync down to a
 * desktop/offline client and every displayed balance would read 100x too large.
 *
 * The fix keeps the wire contract unit-stable: `/sync/bootstrap`, `/sync/pull`
 * and the push-conflict `serverDoc` all emit account balances as major-unit
 * decimals with `balanceUnit: 'major'`, exactly like the REST `/accounts`
 * contract, regardless of how the row is stored.
 */

const createAccount = async (token: string, openingBalance: number, name = 'Checking') => {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance })
    return res.body.data
}

let app: Application

describe('Sync wire format — migrated (minor-unit) account balances', () => {
    let owner: RegisteredUser

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)
    })

    it('bootstrap returns a migrated account in major units with balanceUnit "major"', async () => {
        const account = await createAccount(owner.token, 1234.56)

        const before = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))
        const accountBefore = before.body.data.accounts.find(
            (a: { _id: string }) => a._id === account._id
        )
        expect(accountBefore.openingBalance).toBe(1234.56)
        expect(accountBefore.currentBalance).toBe(1234.56)

        const result = await migrateAccountBalancesToMinorUnits()
        expect(result.accountsMigrated).toBe(1)
        expect((await Account.findById(account._id))?.currentBalance).toBe(123456)

        const after = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))
        const accountAfter = after.body.data.accounts.find(
            (a: { _id: string }) => a._id === account._id
        )
        expect(accountAfter.openingBalance).toBe(1234.56)
        expect(accountAfter.currentBalance).toBe(1234.56)
        expect(accountAfter.balanceUnit).toBe('major')
    })

    it('bootstrap account payload is identical before and after migration (bar updatedAt)', async () => {
        await createAccount(owner.token, 555.55, 'Savings')

        const before = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))
        await migrateAccountBalancesToMinorUnits()
        const after = await request(app).get('/api/v1/sync/bootstrap').set(authHeader(owner.token))

        const strip = (a: Record<string, unknown>) => ({ ...a, updatedAt: undefined })
        expect(after.body.data.accounts.map(strip)).toEqual(before.body.data.accounts.map(strip))
    })

    it('pull returns a migrated account as a change in major units', async () => {
        const account = await createAccount(owner.token, 89.01, 'Credit line')

        const bootstrap = await request(app)
            .get('/api/v1/sync/bootstrap')
            .set(authHeader(owner.token))
        const { checkpoint } = bootstrap.body.data

        await ensureTimestampAdvances()
        await migrateAccountBalancesToMinorUnits()

        const pull = await request(app)
            .get('/api/v1/sync/pull')
            .query({ checkpoint })
            .set(authHeader(owner.token))

        const change = pull.body.data.changes.find(
            (c: { entity: string; doc: { _id: string } }) =>
                c.entity === 'account' && c.doc._id === account._id
        )
        expect(change).toBeDefined()
        expect(change.doc.openingBalance).toBe(89.01)
        expect(change.doc.currentBalance).toBe(89.01)
        expect(change.doc.balanceUnit).toBe('major')
    })

    it('a push-conflict serverDoc reports a migrated account balance in major units', async () => {
        const account = await createAccount(owner.token, 200.75)
        const staleBaseUpdatedAt = (await Account.findById(account._id))!.updatedAt.toISOString()

        await ensureTimestampAdvances()
        await migrateAccountBalancesToMinorUnits()

        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'acct-conflict-1',
                        entity: 'account',
                        operation: 'update',
                        baseUpdatedAt: staleBaseUpdatedAt,
                        payload: { _id: account._id, name: 'Client rename' },
                    },
                ],
            })

        expect(res.body.data.results[0].status).toBe('conflict')
        const serverDoc = res.body.data.results[0].conflict.serverDoc
        expect(serverDoc.openingBalance).toBe(200.75)
        expect(serverDoc.currentBalance).toBe(200.75)
        expect(serverDoc.balanceUnit).toBe('major')
    })

    it('leaves an unmigrated (major-unit) account untouched on the wire', async () => {
        const account = await createAccount(owner.token, 42.1)

        const bootstrap = await request(app)
            .get('/api/v1/sync/bootstrap')
            .set(authHeader(owner.token))
        const wireAccount = bootstrap.body.data.accounts.find(
            (a: { _id: string }) => a._id === account._id
        )
        expect(wireAccount.openingBalance).toBe(42.1)
        expect(wireAccount.currentBalance).toBe(42.1)
        expect(wireAccount.balanceUnit).toBe('major')
    })
})
