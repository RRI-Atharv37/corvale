import request from 'supertest'
import { Application } from 'express'
import { createApp } from '@http/app'
import { Account } from '@modules/accounts'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { registerUser, authHeader, RegisteredUser } from '@tests/helpers'

/**
 * BUG-59: the default-account flag belongs to a member's personal accounts only. A workspace account
 * can never be made default (REST or sync), and a personal default survives that attempt.
 */

describe('Workspace accounts cannot be marked default', () => {
    let app: Application
    let owner: RegisteredUser
    let workspaceId: string
    let personalId: string
    let sharedId: string

    beforeEach(async () => {
        app = createApp()
        owner = await registerUser(app)

        const wsRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Household' })
        workspaceId = wsRes.body.data._id

        const personal = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Personal', type: 'checking' })
        personalId = personal.body.data._id

        const shared = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Shared', type: 'checking', workspaceId })
        sharedId = shared.body.data._id
    })

    const expectStateUntouched = async () => {
        expect((await Account.findById(personalId))?.isDefault).toBe(true)
        expect((await Account.findById(sharedId))?.isDefault).toBe(false)
    }

    it('refuses isDefault on a workspace account via REST and keeps the personal default', async () => {
        const res = await request(app)
            .put(`/api/v1/accounts/${sharedId}`)
            .set(authHeader(owner.token))
            .send({ isDefault: true })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.ACCOUNT.WORKSPACE_DEFAULT_UNSUPPORTED)
        await expectStateUntouched()
    })

    it('refuses isDefault on a workspace account via sync push and keeps the personal default', async () => {
        const res = await request(app)
            .post('/api/v1/sync/push')
            .set(authHeader(owner.token))
            .send({
                ops: [
                    {
                        opId: 'ws-default-1',
                        entity: 'account',
                        operation: 'update',
                        payload: { _id: sharedId, isDefault: true },
                    },
                ],
            })

        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('rejected')
        await expectStateUntouched()
    })

    it('still edits a workspace account that does not touch isDefault', async () => {
        const res = await request(app)
            .put(`/api/v1/accounts/${sharedId}`)
            .set(authHeader(owner.token))
            .send({ name: 'Shared renamed' })

        expect(res.status).toBe(200)
        expect(res.body.data.name).toBe('Shared renamed')
        await expectStateUntouched()
    })

    it('does not let a workspace account creation or a personal default change flip the shared flag', async () => {
        const second = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Personal two', type: 'savings' })

        const res = await request(app)
            .put(`/api/v1/accounts/${second.body.data._id}`)
            .set(authHeader(owner.token))
            .send({ isDefault: true })

        expect(res.status).toBe(200)
        expect((await Account.findById(personalId))?.isDefault).toBe(false)
        expect((await Account.findById(second.body.data._id))?.isDefault).toBe(true)
        expect((await Account.findById(sharedId))?.isDefault).toBe(false)
    })

    it('unsets only personal defaults when a personal default is set, leaving a legacy shared flag alone', async () => {
        await Account.updateOne({ _id: sharedId }, { $set: { isDefault: true } })
        const second = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Personal two', type: 'savings', isDefault: true })

        expect(second.status).toBe(201)
        expect((await Account.findById(sharedId))?.isDefault).toBe(true)
        expect((await Account.findById(personalId))?.isDefault).toBe(false)
    })
})
