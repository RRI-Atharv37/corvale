import { describe, it, expect, beforeEach } from 'vitest'
import { Types } from 'mongoose'

import app from '@http/app'
import { Category } from '@modules/categories'
import { Tag } from '@modules/tags'
import { CategorizationRule } from '@modules/categorization-rules'
import { TransactionTemplate } from '@modules/transaction-templates'
import { SyncOperation } from '@modules/sync'
import { Transaction } from '@modules/transactions'
import { Budget } from '@modules/budgets'
import { Workspace } from '@modules/workspaces'
import { WorkspaceInvite } from '@modules/workspaces'
import { runWithRlsContext } from '@core/access/rowLevelSecurity'
import { registerUser, createSecondUser } from './helpers'
import { ensureMasterCategoriesSeeded } from "@modules/categories/categorySeed";
import { computeBudgetOverview, computeCategoryBreakdown } from "@modules/dashboard/dashboardUtils";
import { computeLargestExpenses, computeBudgetAnalysis } from "@modules/reports/reportUtils";

const UNSCOPED = /missing user or workspace scope/i

describe('SEC-30 — RLS coverage gap (S23)', () => {
    describe('Category has the RLS plugin', () => {
        it('blocks an unscoped Category query inside an authenticated request context', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(Category.find({ name: 'Food' })).rejects.toThrow(UNSCOPED)
            })
        })

        it('allows a userId-scoped Category query', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    Category.find({ userId: new Types.ObjectId(user.userId) })
                ).resolves.toBeDefined()
            })
        })

        it('allows the master-category filter { userId: null }', async () => {
            const user = await registerUser(app)
            await ensureMasterCategoriesSeeded()
            await runWithRlsContext({ userId: user.userId }, async () => {
                const masters = await Category.find({ userId: null })
                expect(masters.length).toBeGreaterThan(0)
            })
        })

        it('allows the mixed { userId: { $in: [id, null] } } filter used by the enrichment call sites', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    Category.find({
                        _id: { $in: [new Types.ObjectId()] },
                        userId: { $in: [new Types.ObjectId(user.userId), null] },
                    })
                ).resolves.toBeDefined()
            })
        })

        it('still allows a bare findById for post-fetch ownership checks', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(Category.findById(new Types.ObjectId())).resolves.toBeNull()
            })
        })

        it('allows a bare { _id: { $in: [...] } } lookup — the shape .populate() issues (S28 regression)', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    Category.find({ _id: { $in: [new Types.ObjectId(), new Types.ObjectId()] } })
                ).resolves.toBeDefined()
            })
        })

        it('still blocks { _id: { $in: [...] } } when a non-id operator is smuggled alongside', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    Category.find({ _id: { $in: [new Types.ObjectId()], $ne: null } })
                ).rejects.toThrow(UNSCOPED)
            })
        })

        it('populating categoryId across several categories does not trip the RLS guard (S28 regression)', async () => {
            const user = await registerUser(app)
            await ensureMasterCategoriesSeeded()
            await runWithRlsContext({ userId: user.userId }, async () => {
                const masters = await Category.find({ userId: null }).limit(3)
                const account = new Types.ObjectId()
                await Transaction.insertMany(
                    masters.map((category, i) => ({
                        userId: new Types.ObjectId(user.userId),
                        accountId: account,
                        categoryId: category._id,
                        type: 'expense' as const,
                        status: 'posted' as const,
                        amount: 100 + i,
                        currency: 'USD',
                        title: `Row ${i}`,
                        date: new Date('2026-01-15T12:00:00.000Z'),
                    }))
                )
                await expect(
                    Transaction.find({ userId: new Types.ObjectId(user.userId) }).populate(
                        'categoryId',
                        'name'
                    )
                ).resolves.toHaveLength(masters.length)
            })
        })
    })

    describe.each([
        ['Tag', Tag],
        ['CategorizationRule', CategorizationRule],
        ['TransactionTemplate', TransactionTemplate],
        ['SyncOperation', SyncOperation],
    ] as const)('%s has the RLS plugin', (_name, model) => {
        it('blocks an unscoped query inside an authenticated request context', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    (model as typeof Tag).find({ name: 'anything' } as Record<string, unknown>)
                ).rejects.toThrow(UNSCOPED)
            })
        })

        it('allows a userId-scoped query', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    (model as typeof Tag).find({ userId: new Types.ObjectId(user.userId) })
                ).resolves.toBeDefined()
            })
        })

        it('allows unscoped queries outside an authenticated request context', async () => {
            await expect(
                (model as typeof Tag).find({ name: 'anything' } as Record<string, unknown>)
            ).resolves.toBeDefined()
        })
    })

    describe('Workspace / WorkspaceInvite are deliberately excluded', () => {
        it('Workspace queries are not membership-blocked by RLS (scoped by ownerId / members.userId instead)', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    Workspace.find({ ownerId: new Types.ObjectId(user.userId) })
                ).resolves.toBeDefined()
                await expect(
                    Workspace.find({ 'members.userId': new Types.ObjectId(user.userId) })
                ).resolves.toBeDefined()
            })
        })

        it('WorkspaceInvite queries are not blocked by RLS (no userId field; scoped by invitee/inviter)', async () => {
            const user = await registerUser(app)
            await runWithRlsContext({ userId: user.userId }, async () => {
                await expect(
                    WorkspaceInvite.find({ inviteeUserId: new Types.ObjectId(user.userId) })
                ).resolves.toBeDefined()
            })
        })
    })

    describe('the four dashboard/report Category enrichment call sites stay functional under RLS', () => {
        let userId: string
        let categoryId: Types.ObjectId
        // Wide window so `computeBudgetOverview` (which resolves the *current* month) always
        // sees the seeded budget, regardless of when the suite runs.
        const periodStart = new Date('2020-01-01T00:00:00.000Z')
        const periodEnd = new Date('2100-12-31T23:59:59.999Z')
        const txDate = new Date('2020-06-15T12:00:00.000Z')

        beforeEach(async () => {
            const user = await registerUser(app)
            userId = user.userId
            await ensureMasterCategoriesSeeded()
            const master = await Category.findOne({ userId: null, name: 'Food' })
            const category = await Category.create({
                userId: new Types.ObjectId(userId),
                masterCategoryId: master?._id ?? null,
                name: 'Groceries',
            })
            categoryId = category._id

            await Transaction.create({
                userId: new Types.ObjectId(userId),
                accountId: new Types.ObjectId(),
                categoryId,
                type: 'expense',
                status: 'posted',
                amount: 5000,
                currency: 'USD',
                title: 'Supermarket',
                date: txDate,
            })

            await Budget.create({
                userId: new Types.ObjectId(userId),
                periodType: 'custom',
                periodStart,
                periodEnd,
                categoryId,
                amount: 10000,
                currency: 'USD',
            })
        })

        it('computeCategoryBreakdown resolves category names (dashboardUtils:647/:658)', async () => {
            await runWithRlsContext({ userId }, async () => {
                const rows = await computeCategoryBreakdown(userId, periodStart, periodEnd, 'expense')
                expect(rows.length).toBeGreaterThan(0)
                expect(rows.some((row) => row.categoryName === 'Food')).toBe(true)
            })
        })

        it('computeBudgetOverview resolves the budget category name (dashboardUtils:475)', async () => {
            await runWithRlsContext({ userId }, async () => {
                const overview = await computeBudgetOverview(userId, 'UTC')
                expect(overview.budgets.some((b) => b.categoryName === 'Groceries')).toBe(true)
            })
        })

        it('computeLargestExpenses resolves category names (reportUtils:369)', async () => {
            await runWithRlsContext({ userId }, async () => {
                const rows = await computeLargestExpenses(userId, periodStart, periodEnd, 10)
                expect(rows.length).toBeGreaterThan(0)
                expect(rows[0].categoryName).toBe('Groceries')
            })
        })

        it('computeBudgetAnalysis resolves category names (reportUtils:687)', async () => {
            await runWithRlsContext({ userId }, async () => {
                const analysis = await computeBudgetAnalysis(
                    userId,
                    {
                        periodType: 'custom',
                        periodStart,
                        periodEnd,
                        startDate: '2020-01-01',
                        endDate: '2100-12-31',
                    },
                    'UTC'
                )
                expect(analysis.budgets.some((item) => item.categoryName === 'Groceries')).toBe(true)
            })
        })

        it('does not enrich with another user\'s category of the same id space', async () => {
            const other = await createSecondUser(app)
            await runWithRlsContext({ userId: other.userId }, async () => {
                const rows = await computeCategoryBreakdown(
                    other.userId,
                    periodStart,
                    periodEnd,
                    'expense'
                )
                expect(rows).toEqual([])
            })
        })
    })
})
