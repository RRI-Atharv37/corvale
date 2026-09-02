import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'

import app from '../app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { assertAccountMatchesWorkspace } from '@core/access/workspace'
import { CustomError } from '@core/errors/customError'
import { authHeader, seedUserDirectly } from './helpers'

const MISMATCH = ERROR_MESSAGES.WORKSPACE.ACCOUNT_WORKSPACE_MISMATCH

async function createWorkspace(token: string, name = 'Shared') {
    const res = await request(app).post('/api/v1/workspaces').set(authHeader(token)).send({ name })
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

async function masterCategoryId(token: string, name = 'Food'): Promise<string> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    return res.body.data.masters.find((m: { name: string }) => m.name === name)._id
}

async function createAccount(
    token: string,
    { workspaceId, name = 'Acct', openingBalance = 5000 }: { workspaceId?: string; name?: string; openingBalance?: number }
): Promise<string> {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance, ...(workspaceId ? { workspaceId } : {}) })
    return res.body.data._id
}

async function createTransaction(token: string, body: Record<string, unknown>) {
    return request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({ type: 'expense', title: 'Tx', amount: 10, date: '2026-01-15T12:00:00.000Z', ...body })
}

async function seedWorkspace() {
    const owner = await seedUserDirectly({ email: 'ws57-owner@example.com' })
    const editor = await seedUserDirectly({
        fullName: 'WS Editor',
        email: 'ws57-editor@example.com',
        password: 'WsEditor123!',
    })
    const workspaceId = await createWorkspace(owner.token)
    await inviteEditor(owner.token, workspaceId, editor.email, editor.token)
    return { owner, editor, workspaceId }
}

describe('SEC-57 — assertAccountMatchesWorkspace helper', () => {
    const wsA = new Types.ObjectId()
    const wsB = new Types.ObjectId()

    it('passes when both sides are personal (null / null)', () => {
        expect(() => assertAccountMatchesWorkspace(null, null)).not.toThrow()
        expect(() => assertAccountMatchesWorkspace(undefined, undefined)).not.toThrow()
    })

    it('passes when the account and target workspace match', () => {
        expect(() => assertAccountMatchesWorkspace(wsA, wsA.toString())).not.toThrow()
    })

    it('rejects a workspace account against a personal target', () => {
        expect(() => assertAccountMatchesWorkspace(wsA, null)).toThrow(MISMATCH)
    })

    it('rejects a personal account against a workspace target', () => {
        expect(() => assertAccountMatchesWorkspace(null, wsA.toString())).toThrow(MISMATCH)
    })

    it('rejects two different workspaces', () => {
        try {
            assertAccountMatchesWorkspace(wsA, wsB.toString())
            throw new Error('expected throw')
        } catch (err) {
            expect(err).toBeInstanceOf(CustomError)
            expect((err as CustomError).statusCode).toBe(400)
            expect((err as CustomError).message).toBe(MISMATCH)
        }
    })
})

describe('SEC-57 — updateTransaction pins account/workspace scope (the two gap sites)', () => {
    it('rejects moving a workspace transaction onto a personal account', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const wsAccount = await createAccount(owner.token, { workspaceId, name: 'WS' })
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)

        const tx = await createTransaction(owner.token, {
            accountId: wsAccount,
            categoryId,
            workspaceId,
        })
        expect(tx.status).toBe(201)

        const res = await request(app)
            .put(`/api/v1/transactions/${tx.body.data._id}`)
            .set(authHeader(owner.token))
            .send({ accountId: personalAccount })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('rejects moving a personal transaction onto a workspace account', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const wsAccount = await createAccount(owner.token, { workspaceId, name: 'WS' })
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)

        const tx = await createTransaction(owner.token, { accountId: personalAccount, categoryId })
        expect(tx.status).toBe(201)

        const res = await request(app)
            .put(`/api/v1/transactions/${tx.body.data._id}`)
            .set(authHeader(owner.token))
            .send({ accountId: wsAccount })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('allows an account change within the same workspace', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const wsAccountA = await createAccount(owner.token, { workspaceId, name: 'WS-A' })
        const wsAccountB = await createAccount(owner.token, { workspaceId, name: 'WS-B' })
        const categoryId = await masterCategoryId(owner.token)

        const tx = await createTransaction(owner.token, {
            accountId: wsAccountA,
            categoryId,
            workspaceId,
        })

        const res = await request(app)
            .put(`/api/v1/transactions/${tx.body.data._id}`)
            .set(authHeader(owner.token))
            .send({ accountId: wsAccountB })

        expect(res.status).toBe(200)
        expect(res.body.data.accountId).toBe(wsAccountB)
    })

    it('allows a personal account change (regression)', async () => {
        const { owner } = await seedWorkspace()
        const personalA = await createAccount(owner.token, { name: 'P-A' })
        const personalB = await createAccount(owner.token, { name: 'P-B' })
        const categoryId = await masterCategoryId(owner.token)

        const tx = await createTransaction(owner.token, { accountId: personalA, categoryId })

        const res = await request(app)
            .put(`/api/v1/transactions/${tx.body.data._id}`)
            .set(authHeader(owner.token))
            .send({ accountId: personalB })

        expect(res.status).toBe(200)
        expect(res.body.data.accountId).toBe(personalB)
    })
})

describe('SEC-57 — the other client-account write paths still reject a cross-workspace account', () => {
    it('POST /transactions (createTransactionForUser)', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)

        const res = await createTransaction(owner.token, {
            accountId: personalAccount,
            categoryId,
            workspaceId,
        })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('POST /transactions/transfer (both legs)', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const wsAccount = await createAccount(owner.token, { workspaceId, name: 'WS' })
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })

        const res = await request(app)
            .post('/api/v1/transactions/transfer')
            .set(authHeader(owner.token))
            .send({
                title: 'Move',
                amount: 10,
                date: '2026-01-15T12:00:00.000Z',
                fromAccountId: wsAccount,
                toAccountId: personalAccount,
                workspaceId,
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('POST /transaction-templates/:id/apply', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)

        const template = await request(app)
            .post('/api/v1/transaction-templates')
            .set(authHeader(owner.token))
            .send({ name: 'T', type: 'expense', amount: 5, accountId: personalAccount, categoryId })

        const res = await request(app)
            .post(`/api/v1/transaction-templates/${template.body.data._id}/apply`)
            .set(authHeader(owner.token))
            .send({ date: '2026-02-01T12:00:00.000Z', workspaceId })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('POST /recurring-rules', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)

        const res = await request(app)
            .post('/api/v1/recurring-rules')
            .set(authHeader(owner.token))
            .send({
                title: 'Rent',
                type: 'expense',
                amount: 100,
                accountId: personalAccount,
                categoryId,
                interval: 'monthly',
                nextDueDate: '2026-03-01',
                workspaceId,
            })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('POST /savings-goals (validateAccountForGoal)', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })

        const res = await request(app)
            .post('/api/v1/savings-goals')
            .set(authHeader(owner.token))
            .send({ name: 'Fund', targetAmount: 1000, accountId: personalAccount, workspaceId })

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(MISMATCH)
    })

    it('POST /import/preview and /import/commit', async () => {
        const { owner, workspaceId } = await seedWorkspace()
        const personalAccount = await createAccount(owner.token, { name: 'Personal' })
        const categoryId = await masterCategoryId(owner.token)
        const body = { accountId: personalAccount, defaultCategoryId: categoryId, workspaceId, parsedRows: [] }

        const preview = await request(app)
            .post('/api/v1/imports/preview')
            .set(authHeader(owner.token))
            .send(body)
        expect(preview.status).toBe(400)
        expect(preview.body.message).toBe(MISMATCH)

        const commit = await request(app)
            .post('/api/v1/imports/commit')
            .set(authHeader(owner.token))
            .send({ ...body, rowDecisions: [] })
        expect(commit.status).toBe(400)
        expect(commit.body.message).toBe(MISMATCH)
    })
})

describe('SEC-58 — sortBy=category $lookup does not leak a co-member private category', () => {
    async function seedLeakScenario() {
        const { owner, editor, workspaceId } = await seedWorkspace()
        const wsAccount = await createAccount(owner.token, { workspaceId, name: 'WS' })
        const foodMaster = await masterCategoryId(owner.token)

        // The editor authors a workspace transaction categorised with their *personal* category.
        const personalCat = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(editor.token))
            .send({ masterCategoryId: foodMaster, name: 'Editor Private Vice', color: '#abcdef' })
        const personalCatId = personalCat.body.data._id

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(editor.token))
            .send({
                type: 'expense',
                title: 'Editor spend',
                amount: 20,
                date: '2026-01-16T12:00:00.000Z',
                accountId: wsAccount,
                categoryId: personalCatId,
                workspaceId,
            })

        return { owner, editor, workspaceId, personalCatId }
    }

    const endpoints = [
        (workspaceId: string) => `/api/v1/transactions?workspaceId=${workspaceId}&sortBy=category&limit=20`,
        (workspaceId: string) =>
            `/api/v1/transactions/filter?workspaceId=${workspaceId}&sortBy=category&startDate=2026-01-01&endDate=2026-01-31`,
        (workspaceId: string) =>
            `/api/v1/transactions/search?workspaceId=${workspaceId}&sortBy=category&keyword=Editor`,
    ]

    it.each(endpoints)('does not expose the joined category document (%#)', async (buildUrl) => {
        const { owner, workspaceId, personalCatId } = await seedLeakScenario()

        const res = await request(app).get(buildUrl(workspaceId)).set(authHeader(owner.token))

        expect(res.status).toBe(200)
        const rows: Array<Record<string, unknown>> = Array.isArray(res.body.data)
            ? res.body.data
            : res.body.data.data
        const target = rows.find((r) => r.title === 'Editor spend')
        expect(target).toBeDefined()
        // The non-sorted path only ever returns `categoryId`; the sorted path must match it.
        expect(target).not.toHaveProperty('category')
        expect(JSON.stringify(res.body)).not.toContain('Editor Private Vice')
        // categoryId itself is not a secret and stays on the row.
        expect(target?.categoryId).toBe(personalCatId)
    })

    it('still returns the rows sorted for the owning member', async () => {
        const { editor, workspaceId } = await seedLeakScenario()

        const res = await request(app)
            .get(`/api/v1/transactions?workspaceId=${workspaceId}&sortBy=category&limit=20`)
            .set(authHeader(editor.token))

        expect(res.status).toBe(200)
        expect(res.body.data.data.some((r: { title: string }) => r.title === 'Editor spend')).toBe(true)
    })
})
