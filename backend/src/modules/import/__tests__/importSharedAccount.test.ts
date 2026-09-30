import { describe, it, expect, vi, afterEach } from 'vitest'
import request from 'supertest'
import app from '@http/app'
import { Transaction } from '@modules/transactions'
import { CategorizationRule } from '@modules/categorization-rules'
import { authHeader, seedUserDirectly } from '@tests/helpers'

const MAPPING = { date: 'Date', description: 'Description', amount: 'Amount' }
const HEADERS = ['Date', 'Description', 'Amount']

async function seedSharedAccount() {
    const owner = await seedUserDirectly({ email: 'import-shared-owner@example.com' })
    const member = await seedUserDirectly({
        fullName: 'Second Member',
        email: 'import-shared-member@example.com',
        password: 'SecondMember123!',
    })

    const workspaceId = (
        await request(app).post('/api/v1/workspaces').set(authHeader(owner.token)).send({ name: 'Joint' })
    ).body.data._id

    const invite = await request(app)
        .post(`/api/v1/workspaces/${workspaceId}/members`)
        .set(authHeader(owner.token))
        .send({ email: member.email, role: 'editor' })
    await request(app)
        .post(`/api/v1/workspaces/invites/${invite.body.data._id}/accept`)
        .set(authHeader(member.token))

    const accountId = (
        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(owner.token))
            .send({ name: 'Joint', type: 'checking', openingBalance: 1000, workspaceId })
    ).body.data._id

    const categories = await request(app).get('/api/v1/categories').set(authHeader(owner.token))
    const categoryId = categories.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id

    return { owner, member, workspaceId, accountId, categoryId }
}

const csvPayload = (
    accountId: string,
    categoryId: string,
    workspaceId: string,
    rows: string[][]
): Record<string, unknown> => ({
    accountId,
    defaultCategoryId: categoryId,
    workspaceId,
    headers: HEADERS,
    rows,
    mapping: MAPPING,
})

const post = (path: string, token: string, body: Record<string, unknown>) =>
    request(app).post(path).set(authHeader(token)).send(body)

describe('Import on a shared workspace account (BUG-65)', () => {
    it('shows every row as a duplicate when a second member re-imports the same statement', async () => {
        const { owner, member, workspaceId, accountId, categoryId } = await seedSharedAccount()
        const rows = [
            ['2026-01-10', 'Coffee Shop', '-5.25'],
            ['2026-01-11', 'Grocer', '-40.00'],
        ]

        const first = await post('/api/v1/imports/commit', owner.token, csvPayload(accountId, categoryId, workspaceId, rows))
        expect(first.status).toBe(201)
        expect(first.body.data.imported).toBe(2)

        const preview = await post('/api/v1/imports/preview', member.token, csvPayload(accountId, categoryId, workspaceId, rows))
        expect(preview.status).toBe(200)
        expect(preview.body.data.summary.duplicates).toBe(2)
        for (const item of preview.body.data.items) {
            expect(item.duplicateOf).toBeDefined()
            expect(first.body.data.transactionIds).toContain(item.duplicateOf.transactionId)
            expect(item.duplicateAction).toBe('skip')
        }

        const second = await post('/api/v1/imports/commit', member.token, csvPayload(accountId, categoryId, workspaceId, rows))
        expect(second.body.data.imported).toBe(0)
        expect(second.body.data.skipped).toBe(2)
        expect(await Transaction.countDocuments({ workspaceId, accountId })).toBe(2)
    })

    it('matches on externalId across members too', async () => {
        const { owner, member, workspaceId, accountId, categoryId } = await seedSharedAccount()
        const withId = {
            accountId,
            defaultCategoryId: categoryId,
            workspaceId,
            parsedRows: [
                { rowIndex: 1, date: '2026-02-01', title: 'Bank fee', amount: 3, type: 'expense', externalId: 'FITID-1' },
            ],
        }

        await post('/api/v1/imports/commit', owner.token, withId)
        const preview = await post('/api/v1/imports/preview', member.token, {
            ...withId,
            parsedRows: [{ ...withId.parsedRows[0], title: 'Bank fee (renamed)' }],
        })

        expect(preview.body.data.summary.duplicates).toBe(1)
    })

    it('lets a second member merge into a row the first member imported', async () => {
        const { owner, member, workspaceId, accountId, categoryId } = await seedSharedAccount()
        const rows = [['2026-01-10', 'Coffee Shop', '-5.25']]

        const first = await post('/api/v1/imports/commit', owner.token, csvPayload(accountId, categoryId, workspaceId, rows))
        const existingId = first.body.data.transactionIds[0]

        const merge = await post('/api/v1/imports/commit', member.token, {
            ...csvPayload(accountId, categoryId, workspaceId, rows),
            rowDecisions: { 1: 'merge' },
        })

        expect(merge.status).toBe(201)
        expect(merge.body.data.merged).toBe(1)
        expect(merge.body.data.mergedTransactionIds).toEqual([existingId])
        expect(await Transaction.countDocuments({ workspaceId, accountId })).toBe(1)
    })

    it('does not treat a personal account row as a duplicate of another user\'s import', async () => {
        const first = await seedUserDirectly({ email: 'import-personal-a@example.com' })
        const second = await seedUserDirectly({ email: 'import-personal-b@example.com' })
        const accountOf = async (token: string) =>
            (
                await request(app)
                    .post('/api/v1/accounts')
                    .set(authHeader(token))
                    .send({ name: 'Checking', type: 'checking', openingBalance: 100 })
            ).body.data._id
        const categories = await request(app).get('/api/v1/categories').set(authHeader(first.token))
        const categoryId = categories.body.data.masters.find((m: { name: string }) => m.name === 'Food')._id
        const rows = [['2026-01-10', 'Coffee Shop', '-5.25']]

        const accountA = await accountOf(first.token)
        const accountB = await accountOf(second.token)
        await post('/api/v1/imports/commit', first.token, {
            accountId: accountA,
            defaultCategoryId: categoryId,
            headers: HEADERS,
            rows,
            mapping: MAPPING,
        })

        const preview = await post('/api/v1/imports/preview', second.token, {
            accountId: accountB,
            defaultCategoryId: categoryId,
            headers: HEADERS,
            rows,
            mapping: MAPPING,
        })
        expect(preview.body.data.summary.duplicates).toBe(0)
    })
})

describe('Import preview loads rules once per request (SEC-87)', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('runs a single rule query for a multi-row preview and still applies the rule', async () => {
        const user = await seedUserDirectly({ email: 'import-rules-once@example.com' })
        const account = (
            await request(app)
                .post('/api/v1/accounts')
                .set(authHeader(user.token))
                .send({ name: 'Checking', type: 'checking', openingBalance: 100 })
        ).body.data
        const categories = (await request(app).get('/api/v1/categories').set(authHeader(user.token))).body.data.masters
        const food = categories.find((m: { name: string }) => m.name === 'Food')._id
        const transport = categories.find((m: { name: string }) => m.name === 'Transport')._id

        const ruleRes = await request(app)
            .post('/api/v1/categorization-rules')
            .set(authHeader(user.token))
            .send({ name: 'Uber', matchType: 'description_contains', matchValue: 'Uber', categoryId: transport })
        expect(ruleRes.status).toBe(201)

        const findSpy = vi.spyOn(CategorizationRule, 'find')
        const rows = Array.from({ length: 12 }, (_, i) => [
            `2026-03-${String(i + 1).padStart(2, '0')}`,
            i % 2 === 0 ? `Uber trip ${i}` : `Cafe ${i}`,
            '-10.00',
        ])

        const res = await post('/api/v1/imports/preview', user.token, {
            accountId: account._id,
            defaultCategoryId: food,
            headers: HEADERS,
            rows,
            mapping: MAPPING,
        })

        expect(res.status).toBe(200)
        expect(findSpy).toHaveBeenCalledTimes(1)
        const uber = res.body.data.items.filter((item: { title: string }) => item.title.startsWith('Uber'))
        expect(uber).toHaveLength(6)
        for (const item of uber) {
            expect(item.categoryId).toBe(transport)
            expect(item.appliedRuleName).toBe('Uber')
        }
    })
})
