import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { authHeader, seedUserDirectly } from '@tests/helpers'

const PRIVATE_NAME = 'Therapy - Dr Rao'

async function seedSharedLedger() {
    const owner = await seedUserDirectly({ email: 'sec80-owner@example.com' })
    const viewer = await seedUserDirectly({ email: 'sec80-viewer@example.com', fullName: 'Sec80 Viewer' })

    const workspaceId = (
        await request(app).post('/api/v1/workspaces').set(authHeader(owner.token)).send({ name: 'Shared' })
    ).body.data._id as string
    const invite = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(owner.token))
        .send({ email: viewer.email, role: 'viewer' })
    await request(app)
        .post(`/api/v1/workspaces/invites/${invite.body.data._id}/accept`)
        .set(authHeader(viewer.token))

    const accountId = (
        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Joint', type: 'checking', openingBalance: 1000, workspaceId })
    ).body.data._id as string

    const categories = await request(app).get('/api/v1/categories').set(authHeader(owner.token))
    const masters = categories.body.data.masters as Array<{ _id: string; name: string }>
    const food = masters.find((m) => m.name === 'Food')!
    const privateCategory = await request(app)
        .post('/api/v1/categories')
        .set(authHeader(owner.token))
        .send({ masterCategoryId: food._id, name: PRIVATE_NAME })
    expect(privateCategory.status).toBe(201)

    const create = (title: string, categoryId: string) =>
        request(app)
            .post('/api/v1/transactions')
            .set(authHeader(owner.token))
            .send({
                type: 'expense',
                title,
                amount: 50,
                date: '2026-01-15T12:00:00.000Z',
                accountId,
                categoryId,
                workspaceId,
            })

    const privateTx = await create('Session', privateCategory.body.data._id)
    expect(privateTx.status).toBe(201)
    const sharedTx = await create('Groceries run', food._id)
    expect(sharedTx.status).toBe(201)

    return { owner, viewer, workspaceId }
}

let ledger: Awaited<ReturnType<typeof seedSharedLedger>>

beforeEach(async () => {
    ledger = await seedSharedLedger()
})

describe('SEC-80 - workspace transaction export does not carry a co-member\'s private category', () => {
    it('csv: a viewer sees the shared master category name but not the author\'s private one', async () => {
        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ workspaceId: ledger.workspaceId, format: 'csv' })
            .set(authHeader(ledger.viewer.token))

        expect(res.status).toBe(200)
        expect(res.text).not.toContain(PRIVATE_NAME)
        expect(res.text).toContain('Session')
        expect(res.text).toContain('Food')
    })

    it('json: the private category name is replaced by a neutral label', async () => {
        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ workspaceId: ledger.workspaceId, format: 'json' })
            .set(authHeader(ledger.viewer.token))

        expect(res.status).toBe(200)
        expect(res.text).not.toContain(PRIVATE_NAME)
        const byTitle = new Map<string, { category: string }>(
            (res.body.transactions as Array<{ title: string; category: string }>).map((t) => [t.title, t])
        )
        expect(byTitle.get('Session')?.category).toBe('Other')
        expect(byTitle.get('Groceries run')?.category).toBe('Food')
    })

    it('pdf: renders for a viewer without the private category (same record builder as json)', async () => {
        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ workspaceId: ledger.workspaceId, format: 'pdf' })
            .set(authHeader(ledger.viewer.token))
            .buffer(true)
            .parse((r, cb) => {
                const chunks: Buffer[] = []
                r.on('data', (c: Buffer) => chunks.push(c))
                r.on('end', () => cb(null, Buffer.concat(chunks)))
            })

        expect(res.status).toBe(200)
        expect((res.body as Buffer).toString('latin1')).not.toContain(PRIVATE_NAME)
    })

    it('the author still sees their own private category in the same export', async () => {
        const csv = await request(app)
            .get('/api/v1/transactions/download')
            .query({ workspaceId: ledger.workspaceId, format: 'csv' })
            .set(authHeader(ledger.owner.token))
        expect(csv.status).toBe(200)
        expect(csv.text).toContain(PRIVATE_NAME)

        const json = await request(app)
            .get('/api/v1/transactions/download')
            .query({ workspaceId: ledger.workspaceId, format: 'json' })
            .set(authHeader(ledger.owner.token))
        expect(json.text).toContain(PRIVATE_NAME)
    })

    it('a personal export still names the caller\'s own private category', async () => {
        const solo = await seedUserDirectly({ email: 'sec80-solo@example.com' })
        const account = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(solo.token))
            .send({ name: 'Solo', type: 'checking', openingBalance: 100 })
        const masters = (await request(app).get('/api/v1/categories').set(authHeader(solo.token))).body.data
            .masters as Array<{ _id: string; name: string }>
        const category = await request(app)
            .post('/api/v1/categories')
            .set(authHeader(solo.token))
            .send({ masterCategoryId: masters.find((m) => m.name === 'Food')!._id, name: 'Snacks' })
        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(solo.token))
            .send({
                type: 'expense',
                title: 'Crisps',
                amount: 3,
                date: '2026-01-15T12:00:00.000Z',
                accountId: account.body.data._id,
                categoryId: category.body.data._id,
            })

        const res = await request(app)
            .get('/api/v1/transactions/download')
            .query({ format: 'csv' })
            .set(authHeader(solo.token))

        expect(res.text).toContain('Snacks')
    })
})
