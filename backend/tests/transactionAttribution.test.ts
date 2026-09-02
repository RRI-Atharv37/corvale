import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { authHeader, registerUser } from './helpers'

/**
 * SEC-59: `duplicateTransaction` must stamp the caller's `userId` on the copy, not the original
 * author's. In a shared workspace any editor can duplicate a row a co-member created — copying
 * the source `userId` forges that member's authorship.
 */

async function masterCategoryId(token: string, name = 'Food'): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === name)._id
}

async function createAccount(token: string, body: Record<string, unknown>) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name: 'Acct', type: 'checking', openingBalance: 5000, ...body })
    return res.body.data._id as string
}

async function createTransaction(token: string, body: Record<string, unknown>) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({ type: 'expense', title: 'Team lunch', amount: 20, date: '2026-02-01T12:00:00.000Z', ...body })
}

async function createWorkspace(token: string) {
    const res = await request(app).post('/api/v1/workspaces').set(authHeader(token)).send({ name: 'Shared' })
    return res.body.data._id as string
}

async function inviteEditor(ownerToken: string, workspaceId: string, email: string, inviteeToken: string) {
    const invite = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(ownerToken))
        .send({ email, role: 'editor' })
    await request(app)
        .post(`/api/v1/workspaces/invites/${invite.body.data._id}/accept`)
        .set(authHeader(inviteeToken))
}

describe('SEC-59 — duplicateTransaction attributes the copy to the caller', () => {
    it('a workspace editor duplicating a co-member row gets a copy owned by the editor', async () => {
        const owner = await registerUser(app, { email: 'sec59-owner@example.com' })
        const editor = await registerUser(app, {
            fullName: 'Editor',
            email: 'sec59-editor@example.com',
            password: 'EditorPass123!',
        })
        const workspaceId = await createWorkspace(owner.token)
        await inviteEditor(owner.token, workspaceId, editor.email, editor.token)

        const accountId = await createAccount(owner.token, { name: 'WS', workspaceId })
        const categoryId = await masterCategoryId(owner.token)

        const original = await createTransaction(owner.token, { accountId, categoryId, workspaceId })
        expect(original.status).toBe(201)
        expect(original.body.data.userId).toBe(owner.userId)

        const dup = await request(app)
            .post(`/api/v1/transactions/duplicate/${original.body.data._id}`)
            .set(authHeader(editor.token))
            .send({ workspaceId })

        expect(dup.status).toBe(201)
        expect(dup.body.data.userId).toBe(editor.userId)
        expect(dup.body.data.userId).not.toBe(owner.userId)
        expect(dup.body.data.workspaceId).toBe(workspaceId)
        expect(dup.body.data.title).toBe('Team lunch')
    })

    it('a personal duplicate is still owned by that user', async () => {
        const user = await registerUser(app, { email: 'sec59-solo@example.com' })
        const accountId = await createAccount(user.token, { name: 'Solo' })
        const categoryId = await masterCategoryId(user.token)

        const original = await createTransaction(user.token, { accountId, categoryId, title: 'Coffee', amount: 4 })
        expect(original.status).toBe(201)

        const dup = await request(app)
            .post(`/api/v1/transactions/duplicate/${original.body.data._id}`)
            .set(authHeader(user.token))

        expect(dup.status).toBe(201)
        expect(dup.body.data.userId).toBe(user.userId)
    })
})
