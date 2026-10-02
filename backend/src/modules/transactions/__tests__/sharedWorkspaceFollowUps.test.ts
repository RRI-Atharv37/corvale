import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { authHeader, seedUserDirectly } from '@tests/helpers'
import { Transaction } from '@modules/transactions'

async function seedWorkspace() {
    const author = await seedUserDirectly({ email: 'bug54-author@example.com' })
    const editor = await seedUserDirectly({
        fullName: 'Bug54 Editor',
        email: 'bug54-editor@example.com',
        password: 'Bug54Editor123!',
    })
    const created = await request(app)
        .post('/api/v1/workspaces')
        .set(authHeader(author.token))
        .send({ name: 'Shared' })
    const workspaceId = created.body.data._id as string
    const invite = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(author.token))
        .send({ email: editor.email, role: 'editor' })
    await request(app)
        .post(`/api/v1/workspaces/invites/${invite.body.data._id}/accept`)
        .set(authHeader(editor.token))
    return { author, editor, workspaceId }
}

async function createAccount(token: string, workspaceId: string, name: string, openingBalance = 1000) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({ name, type: 'checking', openingBalance, workspaceId })
    return res.body.data._id as string
}

async function balanceOf(token: string, accountId: string): Promise<number> {
    const res = await request(app).get(`/api/v1/accounts/${accountId}`).set(authHeader(token))
    return res.body.data.currentBalance as number
}

async function masterCategoryIds(token: string): Promise<[string, string]> {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const masters = res.body.data.masters as Array<{ _id: string }>
    return [masters[0]._id, masters[1]._id]
}

async function createTransfer(token: string, workspaceId: string, fromAccountId: string, toAccountId: string) {
    const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set(authHeader(token))
        .send({
            title: 'Move',
            amount: 100,
            date: '2026-01-15T12:00:00.000Z',
            fromAccountId,
            toAccountId,
            workspaceId,
        })
    expect(res.status).toBe(201)
    return res.body.data as { outbound: { _id: string }; inbound: { _id: string } }
}

async function createSplitParent(token: string, workspaceId: string, accountId: string) {
    const [catA, catB] = await masterCategoryIds(token)
    const res = await request(app)
        .post('/api/v1/transactions')
        .set(authHeader(token))
        .send({
            type: 'expense',
            title: 'Groceries and more',
            amount: 60,
            date: '2026-01-15T12:00:00.000Z',
            accountId,
            categoryId: catA,
            workspaceId,
            splits: [
                { categoryId: catA, amount: 40 },
                { categoryId: catB, amount: 20 },
            ],
        })
    expect(res.status).toBe(201)
    return res.body.data._id as string
}

const liveSplitLines = (parentId: string) => Transaction.countDocuments({ splitTransactionId: parentId })

async function listWorkspaceTransactionIds(token: string, workspaceId: string): Promise<string[]> {
    const res = await request(app)
        .get(`/api/v1/transactions?workspaceId=${workspaceId}&limit=100`)
        .set(authHeader(token))
    expect(res.status).toBe(200)
    return (res.body.data.data as Array<{ _id: string }>).map((row) => row._id)
}

const push = (token: string, workspaceId: string, op: Record<string, unknown>) =>
    request(app).post('/api/v1/sync/push').set(authHeader(token)).send({ workspaceId, ops: [op] })

describe('BUG-54 - a non-author editor acting on a co-member transfer', () => {
    it('DELETE tombstones both legs and reverses the balances exactly once', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const from = await createAccount(author.token, workspaceId, 'From')
        const to = await createAccount(author.token, workspaceId, 'To')
        const transfer = await createTransfer(author.token, workspaceId, from, to)

        const fromAfterTransfer = await balanceOf(editor.token, from)
        const toAfterTransfer = await balanceOf(editor.token, to)

        const first = await request(app)
            .delete(`/api/v1/transactions/${transfer.outbound._id}`)
            .set(authHeader(editor.token))
        expect(first.status).toBe(200)

        const ids = await listWorkspaceTransactionIds(author.token, workspaceId)
        expect(ids).not.toContain(transfer.outbound._id)
        expect(ids).not.toContain(transfer.inbound._id)
        expect(await balanceOf(editor.token, from)).toBe(fromAfterTransfer + 100)
        expect(await balanceOf(editor.token, to)).toBe(toAfterTransfer - 100)

        const second = await request(app)
            .delete(`/api/v1/transactions/${transfer.outbound._id}`)
            .set(authHeader(editor.token))
        expect(second.status).toBe(404)
        expect(await balanceOf(editor.token, from)).toBe(fromAfterTransfer + 100)
        expect(await balanceOf(editor.token, to)).toBe(toAfterTransfer - 100)
    })

    it('DELETE of the inbound leg behaves the same', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const from = await createAccount(author.token, workspaceId, 'From')
        const to = await createAccount(author.token, workspaceId, 'To')
        const transfer = await createTransfer(author.token, workspaceId, from, to)

        const res = await request(app)
            .delete(`/api/v1/transactions/${transfer.inbound._id}`)
            .set(authHeader(editor.token))
        expect(res.status).toBe(200)

        const ids = await listWorkspaceTransactionIds(author.token, workspaceId)
        expect(ids).not.toContain(transfer.outbound._id)
        expect(ids).not.toContain(transfer.inbound._id)
    })

    it('sync push delete tombstones both legs', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const from = await createAccount(author.token, workspaceId, 'From')
        const to = await createAccount(author.token, workspaceId, 'To')
        const transfer = await createTransfer(author.token, workspaceId, from, to)

        const res = await push(editor.token, workspaceId, {
            opId: 'bug54-transfer-delete',
            entity: 'transaction',
            operation: 'delete',
            payload: { _id: transfer.outbound._id },
        })
        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        const ids = await listWorkspaceTransactionIds(author.token, workspaceId)
        expect(ids).not.toContain(transfer.outbound._id)
        expect(ids).not.toContain(transfer.inbound._id)
    })
})

describe('BUG-54 - a non-author editor acting on a co-member split parent', () => {
    it('reads the split lines in the detail response', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const account = await createAccount(author.token, workspaceId, 'Shared')
        const parentId = await createSplitParent(author.token, workspaceId, account)

        const authorView = await request(app)
            .get(`/api/v1/transactions/${parentId}`)
            .set(authHeader(author.token))
        const editorView = await request(app)
            .get(`/api/v1/transactions/${parentId}`)
            .set(authHeader(editor.token))

        expect(authorView.body.data.splits).toHaveLength(2)
        expect(editorView.status).toBe(200)
        expect(editorView.body.data.splits).toHaveLength(2)
    })

    it('refuses to edit the parent, as it does for the author', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const account = await createAccount(author.token, workspaceId, 'Shared')
        const parentId = await createSplitParent(author.token, workspaceId, account)

        const authorRes = await request(app)
            .put(`/api/v1/transactions/${parentId}`)
            .set(authHeader(author.token))
            .send({ amount: 5 })
        const editorRes = await request(app)
            .put(`/api/v1/transactions/${parentId}`)
            .set(authHeader(editor.token))
            .send({ amount: 5 })

        expect(authorRes.status).toBe(400)
        expect(editorRes.status).toBe(400)
        expect(editorRes.body.message).toBe(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE)
    })

    it('refuses to duplicate the parent', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const account = await createAccount(author.token, workspaceId, 'Shared')
        const parentId = await createSplitParent(author.token, workspaceId, account)
        const before = await listWorkspaceTransactionIds(author.token, workspaceId)

        const res = await request(app)
            .post(`/api/v1/transactions/duplicate/${parentId}`)
            .set(authHeader(editor.token))

        expect(res.status).toBe(400)
        expect(res.body.message).toBe(ERROR_MESSAGES.TRANSACTION.SPLIT_NOT_EDITABLE)
        expect(await listWorkspaceTransactionIds(author.token, workspaceId)).toHaveLength(before.length)
    })

    it('DELETE tombstones the parent and every split child', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const account = await createAccount(author.token, workspaceId, 'Shared')
        const parentId = await createSplitParent(author.token, workspaceId, account)
        // Split lines are not listed on their own; the list shows the parent only.
        expect(await listWorkspaceTransactionIds(author.token, workspaceId)).toEqual([parentId])
        expect(await liveSplitLines(parentId)).toBe(2)
        const balanceBefore = await balanceOf(editor.token, account)

        const res = await request(app)
            .delete(`/api/v1/transactions/${parentId}`)
            .set(authHeader(editor.token))
        expect(res.status).toBe(200)

        expect(await listWorkspaceTransactionIds(author.token, workspaceId)).toHaveLength(0)
        expect(await liveSplitLines(parentId)).toBe(0)
        expect(await balanceOf(editor.token, account)).toBe(balanceBefore + 60)
    })

    it('sync push delete tombstones the parent and every split child', async () => {
        const { author, editor, workspaceId } = await seedWorkspace()
        const account = await createAccount(author.token, workspaceId, 'Shared')
        const parentId = await createSplitParent(author.token, workspaceId, account)

        const res = await push(editor.token, workspaceId, {
            opId: 'bug54-split-delete',
            entity: 'transaction',
            operation: 'delete',
            payload: { _id: parentId },
        })
        expect(res.status).toBe(200)
        expect(res.body.data.results[0].status).toBe('applied')

        expect(await listWorkspaceTransactionIds(author.token, workspaceId)).toHaveLength(0)
        expect(await liveSplitLines(parentId)).toBe(0)
    })
})

describe('BUG-54 - the author path is unchanged (regression)', () => {
    it('the author still deletes their own transfer once', async () => {
        const { author, workspaceId } = await seedWorkspace()
        const from = await createAccount(author.token, workspaceId, 'From')
        const to = await createAccount(author.token, workspaceId, 'To')
        const transfer = await createTransfer(author.token, workspaceId, from, to)

        const res = await request(app)
            .delete(`/api/v1/transactions/${transfer.outbound._id}`)
            .set(authHeader(author.token))
        expect(res.status).toBe(200)

        const ids = await listWorkspaceTransactionIds(author.token, workspaceId)
        expect(ids).not.toContain(transfer.outbound._id)
        expect(ids).not.toContain(transfer.inbound._id)
    })

    it('a personal split parent still deletes with its children', async () => {
        const user = await seedUserDirectly({ email: 'bug54-personal@example.com' })
        const account = (
            await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(user.token))
                .send({ name: 'Personal', type: 'checking', openingBalance: 1000 })
        ).body.data._id as string
        const [catA, catB] = await masterCategoryIds(user.token)
        const created = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(user.token))
            .send({
                type: 'expense',
                title: 'Split',
                amount: 60,
                date: '2026-01-15T12:00:00.000Z',
                accountId: account,
                categoryId: catA,
                splits: [
                    { categoryId: catA, amount: 40 },
                    { categoryId: catB, amount: 20 },
                ],
            })
        expect(created.status).toBe(201)

        const res = await request(app)
            .delete(`/api/v1/transactions/${created.body.data._id}`)
            .set(authHeader(user.token))
        expect(res.status).toBe(200)

        const list = await request(app).get('/api/v1/transactions?limit=100').set(authHeader(user.token))
        expect(list.body.data.data).toHaveLength(0)
    })
})
