import { describe, it, expect } from 'vitest'
import request from 'supertest'

import app from '@http/app'
import { Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { CategorizationRule } from '@modules/categorization-rules'
import { RecurringRule } from '@modules/recurring'
import { SavingsGoal } from '@modules/savings-goals'
import { Transaction } from '@modules/transactions'
import { TransactionTemplate } from '@modules/transaction-templates'
import { authHeader, seedUserDirectly } from '@tests/helpers'

/**
 * S50 / SEC-85: a crafted backup must not install values the REST API would refuse or derive, and
 * S50 / BUG-64: an ordinary export must round-trip the fields users rely on.
 */

const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: { workspaceId: null },
    counts: {},
    accounts: [],
    categories: [],
    tags: [],
    budgets: [],
    savingsGoals: [],
    savingsGoalContributions: [],
    recurringRules: [],
    categorizationRules: [],
    transactionTemplates: [],
    transactions: [],
    receipts: [],
    ...overrides,
})

const getMasterId = async (token: string, name: string): Promise<string> => {
    const res = await request(app).get('/api/v1/categories').set(authHeader(token))
    const master = res.body.data.masters.find((m: { name: string }) => m.name === name)
    if (!master) throw new Error(`${name} master category not found`)
    return master._id
}

const accountRecord = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    name: `Account ${id}`,
    type: 'checking',
    currency: 'USD',
    openingBalance: 1000,
    ...overrides,
})

const transactionRecord = (
    id: string,
    accountId: string,
    categoryId: string,
    overrides: Record<string, unknown> = {}
) => ({
    id,
    accountId,
    categoryId,
    type: 'expense',
    status: 'posted',
    amount: 1000,
    currency: 'USD',
    title: `Txn ${id}`,
    date: '2026-01-15T12:00:00.000Z',
    ...overrides,
})

const transferLegs = (foodId: string, overrides: { out?: Record<string, unknown>; in?: Record<string, unknown> } = {}) => [
    transactionRecord('out', 'A', foodId, {
        type: 'transfer',
        amount: 2500,
        transferPairId: 'in',
        ...overrides.out,
    }),
    transactionRecord('in', 'B', foodId, {
        type: 'transfer',
        amount: 2500,
        transferPairId: 'out',
        ...overrides.in,
    }),
]

const restore = (token: string, backup: unknown) =>
    request(app).post('/api/v1/backup/restore').set(authHeader(token)).send({ backup })

const preview = (token: string, backup: unknown) =>
    request(app).post('/api/v1/backup/preview').set(authHeader(token)).send({ backup })

const untouched = async (userId: string) => {
    expect(await Account.countDocuments({ userId })).toBe(0)
    expect(await Transaction.countDocuments({ userId })).toBe(0)
    expect(await Budget.countDocuments({ userId })).toBe(0)
    expect(await SavingsGoal.countDocuments({ userId })).toBe(0)
    expect(await RecurringRule.countDocuments({ userId })).toBe(0)
    expect(await CategorizationRule.countDocuments({ userId })).toBe(0)
    expect(await TransactionTemplate.countDocuments({ userId })).toBe(0)
}

describe('Backup restore - derived values are recomputed (SEC-85)', () => {
    it('recomputes a goal amount from its contributions instead of trusting the file', async () => {
        const target = await seedUserDirectly({ email: 'sec85-goal@example.com' })
        const res = await restore(
            target.token,
            buildPayload({
                savingsGoals: [
                    { id: 'g1', name: 'Fund', targetAmount: 100000, currentAmount: 99999, currency: 'USD', status: 'active' },
                ],
                savingsGoalContributions: [
                    { id: 'c1', goalId: 'g1', amount: 500, type: 'manual', contributedAt: '2026-01-10T00:00:00.000Z' },
                    { id: 'c2', goalId: 'g1', amount: 250, type: 'manual', contributedAt: '2026-01-11T00:00:00.000Z' },
                ],
            })
        )

        expect(res.status).toBe(201)
        expect(res.body.data.warnings.join(' ')).toMatch(/recalculated/i)
        const goal = await SavingsGoal.findOne({ userId: target.userId })
        expect(goal?.currentAmount).toBe(750)
        expect(goal?.status).toBe('active')
    })

    it('zeroes a goal that carries an amount but no contributions', async () => {
        const target = await seedUserDirectly({ email: 'sec85-goal-zero@example.com' })
        const res = await restore(
            target.token,
            buildPayload({
                savingsGoals: [{ id: 'g1', name: 'Fund', targetAmount: 5000, currentAmount: 5000, currency: 'USD', status: 'completed' }],
            })
        )

        expect(res.status).toBe(201)
        const goal = await SavingsGoal.findOne({ userId: target.userId })
        expect(goal?.currentAmount).toBe(0)
        expect(goal?.status).toBe('active')
    })

    it('marks a goal completed when its contributions reach the target', async () => {
        const target = await seedUserDirectly({ email: 'sec85-goal-done@example.com' })
        const res = await restore(
            target.token,
            buildPayload({
                savingsGoals: [{ id: 'g1', name: 'Fund', targetAmount: 500, currentAmount: 0, currency: 'USD', status: 'active' }],
                savingsGoalContributions: [
                    { id: 'c1', goalId: 'g1', amount: 500, type: 'manual', contributedAt: '2026-01-10T00:00:00.000Z' },
                ],
            })
        )

        expect(res.status).toBe(201)
        const goal = await SavingsGoal.findOne({ userId: target.userId })
        expect(goal?.currentAmount).toBe(500)
        expect(goal?.status).toBe('completed')
    })

    it('ignores a supplied account balance', async () => {
        const target = await seedUserDirectly({ email: 'sec85-balance@example.com' })
        const res = await restore(
            target.token,
            buildPayload({ accounts: [accountRecord('A', { openingBalance: 1000, currentBalance: 9_999_999 })] })
        )

        expect(res.status).toBe(201)
        const account = await Account.findOne({ userId: target.userId })
        expect(account?.currentBalance).toBeCloseTo(1000, 2)
    })

    it('derives hasSplitChildren from the restored children, not from the file', async () => {
        const target = await seedUserDirectly({ email: 'sec85-haschildren@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const res = await restore(
            target.token,
            buildPayload({
                accounts: [accountRecord('A')],
                transactions: [
                    transactionRecord('lonely', 'A', foodId, { hasSplitChildren: true }),
                    transactionRecord('parent', 'A', foodId, { amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 600, splitTransactionId: 'parent' }),
                    transactionRecord('c2', 'A', foodId, { amount: 400, splitTransactionId: 'parent' }),
                ],
            })
        )

        expect(res.status).toBe(201)
        const lonely = await Transaction.findOne({ userId: target.userId, title: 'Txn lonely' })
        const parent = await Transaction.findOne({ userId: target.userId, title: 'Txn parent' })
        expect(lonely?.hasSplitChildren).toBe(false)
        expect(parent?.hasSplitChildren).toBe(true)
    })
})

describe('Backup restore - transfer invariants (SEC-85)', () => {
    const cases: Array<[string, (foodId: string) => Record<string, unknown>]> = [
        [
            'an unpaired transfer leg',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactions: [transactionRecord('solo', 'A', foodId, { type: 'transfer', amount: 100 })],
            }),
        ],
        [
            'a transfer whose pair is an ordinary transaction',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: [
                    transactionRecord('out', 'A', foodId, { type: 'transfer', amount: 100, transferPairId: 'plain' }),
                    transactionRecord('plain', 'B', foodId, { amount: 100 }),
                ],
            }),
        ],
        [
            'a transfer whose pair id names a budget',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                budgets: [
                    {
                        id: 'bud1',
                        name: 'Trojan',
                        periodType: 'monthly',
                        periodStart: '2026-01-01T00:00:00.000Z',
                        periodEnd: '2026-01-31T23:59:59.999Z',
                        amount: 100,
                        currency: 'USD',
                        accountIds: [],
                    },
                ],
                transactions: [
                    transactionRecord('out', 'A', foodId, { type: 'transfer', amount: 100, transferPairId: 'bud1' }),
                    transactionRecord('in', 'B', foodId, { type: 'transfer', amount: 100, transferPairId: 'out' }),
                ],
            }),
        ],
        [
            'legs that do not point at each other',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: [
                    ...transferLegs(foodId, { in: { transferPairId: 'third' } }),
                    transactionRecord('third', 'A', foodId, { type: 'transfer', amount: 2500, transferPairId: 'in' }),
                ],
            }),
        ],
        [
            'legs on the same account',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: transferLegs(foodId, { in: { accountId: 'A' } }),
            }),
        ],
        [
            'legs with different amounts',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: transferLegs(foodId, { in: { amount: 9999 } }),
            }),
        ],
        [
            'legs between accounts of different currencies',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B', { currency: 'EUR' })],
                transactions: transferLegs(foodId, { in: { currency: 'EUR' } }),
            }),
        ],
        [
            'two legs claiming the same direction',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: transferLegs(foodId, { out: { transferRole: 'out' }, in: { transferRole: 'out' } }),
            }),
        ],
        [
            'a non-transfer that carries a pair id',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: [
                    transactionRecord('x', 'A', foodId, { transferPairId: 'y' }),
                    transactionRecord('y', 'B', foodId),
                ],
            }),
        ],
    ]

    it.each(cases)('refuses %s and writes nothing', async (_label, build) => {
        const target = await seedUserDirectly({ email: `sec85-transfer-${Math.random().toString(36).slice(2)}@example.com` })
        const foodId = await getMasterId(target.token, 'Food')
        const payload = buildPayload(build(foodId))

        const previewRes = await preview(target.token, payload)
        expect(previewRes.status).toBe(200)
        expect(previewRes.body.data.valid).toBe(false)

        const res = await restore(target.token, payload)
        expect(res.status).toBe(400)
        await untouched(target.userId)
    })

    it('still restores a well-formed pair', async () => {
        const target = await seedUserDirectly({ email: 'sec85-transfer-ok@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const res = await restore(
            target.token,
            buildPayload({ accounts: [accountRecord('A'), accountRecord('B')], transactions: transferLegs(foodId) })
        )

        expect(res.status).toBe(201)
        const legs = await Transaction.find({ userId: target.userId, type: 'transfer' })
        expect(legs).toHaveLength(2)
        expect(legs.map((leg) => leg.transferRole).sort()).toEqual(['in', 'out'])
    })
})

describe('Backup restore - split invariants (SEC-85)', () => {
    const cases: Array<[string, (foodId: string) => Record<string, unknown>]> = [
        [
            'split lines that do not add up to the parent',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactions: [
                    transactionRecord('parent', 'A', foodId, { amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 600, splitTransactionId: 'parent' }),
                    transactionRecord('c2', 'A', foodId, { amount: 300, splitTransactionId: 'parent' }),
                ],
            }),
        ],
        [
            'a split parent with a single line',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactions: [
                    transactionRecord('parent', 'A', foodId, { amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 1000, splitTransactionId: 'parent' }),
                ],
            }),
        ],
        [
            'a split line under a transfer leg',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: [
                    ...transferLegs(foodId),
                    transactionRecord('c1', 'A', foodId, { amount: 1500, splitTransactionId: 'out' }),
                    transactionRecord('c2', 'A', foodId, { amount: 1000, splitTransactionId: 'out' }),
                ],
            }),
        ],
        [
            'a split line under another split line',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactions: [
                    transactionRecord('parent', 'A', foodId, { amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 500, splitTransactionId: 'parent' }),
                    transactionRecord('c2', 'A', foodId, { amount: 500, splitTransactionId: 'parent' }),
                    transactionRecord('g1', 'A', foodId, { amount: 500, splitTransactionId: 'c1' }),
                ],
            }),
        ],
        [
            'split lines on a different account from the parent',
            (foodId) => ({
                accounts: [accountRecord('A'), accountRecord('B')],
                transactions: [
                    transactionRecord('parent', 'A', foodId, { amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 500, splitTransactionId: 'parent' }),
                    transactionRecord('c2', 'B', foodId, { amount: 500, splitTransactionId: 'parent' }),
                ],
            }),
        ],
        [
            'a split parent that is income',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactions: [
                    transactionRecord('parent', 'A', foodId, { type: 'income', amount: 1000 }),
                    transactionRecord('c1', 'A', foodId, { amount: 500, splitTransactionId: 'parent' }),
                    transactionRecord('c2', 'A', foodId, { amount: 500, splitTransactionId: 'parent' }),
                ],
            }),
        ],
    ]

    it.each(cases)('refuses %s and writes nothing', async (_label, build) => {
        const target = await seedUserDirectly({ email: `sec85-split-${Math.random().toString(36).slice(2)}@example.com` })
        const foodId = await getMasterId(target.token, 'Food')
        const payload = buildPayload(build(foodId))

        expect((await preview(target.token, payload)).body.data.valid).toBe(false)
        const res = await restore(target.token, payload)
        expect(res.status).toBe(400)
        await untouched(target.userId)
    })
})

describe('Backup restore - transaction field bounds (SEC-85)', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ['a fractional amount', { amount: 10.5 }],
        ['a negative amount', { amount: -5 }],
        ['an amount past the safe integer range', { amount: Number.MAX_SAFE_INTEGER + 2 }],
        ['an amount sent as a string', { amount: '100' }],
        ['a currency that does not match the account', { currency: 'EUR' }],
        ['an unknown type', { type: 'refund' }],
        ['an unknown status', { status: 'void' }],
        ['an unknown cleared status', { clearedStatus: 'settled' }],
        ['an unreadable date', { date: 'not-a-date' }],
        ['an oversized external id', { externalId: 'x'.repeat(300) }],
        ['tags that are not strings', { tags: [{ a: 1 }] }],
    ]

    it.each(cases)('refuses %s', async (_label, override) => {
        const target = await seedUserDirectly({ email: `sec85-tx-${Math.random().toString(36).slice(2)}@example.com` })
        const foodId = await getMasterId(target.token, 'Food')
        const payload = buildPayload({
            accounts: [accountRecord('A')],
            transactions: [transactionRecord('t1', 'A', foodId, override)],
        })

        const res = await restore(target.token, payload)
        expect(res.status).toBe(400)
        await untouched(target.userId)
    })

    it('refuses two transactions that share an id', async () => {
        const target = await seedUserDirectly({ email: 'sec85-dupe@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const res = await restore(
            target.token,
            buildPayload({
                accounts: [accountRecord('A')],
                transactions: [transactionRecord('t1', 'A', foodId), transactionRecord('t1', 'A', foodId)],
            })
        )

        expect(res.status).toBe(400)
        await untouched(target.userId)
    })
})

describe('Backup restore - account, budget, goal, recurring, rule and template bounds (SEC-85)', () => {
    const now = '2026-01-01T00:00:00.000Z'

    const cases: Array<[string, (foodId: string) => Record<string, unknown>]> = [
        ['a fractional minor-unit opening balance', () => ({ accounts: [accountRecord('A', { balanceUnit: 'minor', openingBalance: 10.5 })] })],
        ['a non-numeric opening balance', () => ({ accounts: [accountRecord('A', { openingBalance: 'lots' })] })],
        ['credit terms on a checking account', () => ({ accounts: [accountRecord('A', { interestRate: 12, minimumPayment: 25 })] })],
        ['a negative interest rate', () => ({ accounts: [accountRecord('A', { type: 'credit', interestRate: -1 })] })],
        [
            'a fractional budget amount',
            () => ({
                budgets: [{ id: 'b1', name: 'B', periodType: 'monthly', periodStart: now, periodEnd: '2026-01-31T23:59:59.999Z', amount: 100.5, currency: 'USD' }],
            }),
        ],
        [
            'a budget that ends before it starts',
            () => ({
                budgets: [{ id: 'b1', name: 'B', periodType: 'custom', periodStart: '2026-02-01T00:00:00.000Z', periodEnd: now, amount: 100, currency: 'USD' }],
            }),
        ],
        [
            'a fractional goal target',
            () => ({ savingsGoals: [{ id: 'g1', name: 'G', targetAmount: 10.5, currency: 'USD' }] }),
        ],
        [
            'a fractional contribution',
            () => ({
                savingsGoals: [{ id: 'g1', name: 'G', targetAmount: 1000, currency: 'USD' }],
                savingsGoalContributions: [{ id: 'c1', goalId: 'g1', amount: 1.5, type: 'manual', contributedAt: now }],
            }),
        ],
        [
            'an auto-contribution day outside 1-28',
            () => ({
                savingsGoals: [
                    { id: 'g1', name: 'G', targetAmount: 1000, currency: 'USD', autoContribution: { enabled: true, amount: 100, interval: 'monthly', dayOfMonth: 40 } },
                ],
            }),
        ],
        [
            'a custom recurring rule with no interval days',
            (foodId) => ({
                accounts: [accountRecord('A')],
                recurringRules: [
                    { id: 'r1', title: 'R', type: 'expense', amount: 100, currency: 'USD', accountId: 'A', categoryId: foodId, interval: 'custom', nextDueDate: now },
                ],
            }),
        ],
        [
            'a fractional recurring amount',
            (foodId) => ({
                accounts: [accountRecord('A')],
                recurringRules: [
                    { id: 'r1', title: 'R', type: 'expense', amount: 100.25, currency: 'USD', accountId: 'A', categoryId: foodId, interval: 'monthly', nextDueDate: now },
                ],
            }),
        ],
        [
            'a recurring transfer',
            (foodId) => ({
                accounts: [accountRecord('A')],
                recurringRules: [
                    { id: 'r1', title: 'R', type: 'transfer', amount: 100, currency: 'USD', accountId: 'A', categoryId: foodId, interval: 'monthly', nextDueDate: now },
                ],
            }),
        ],
        [
            'a recurring rule in another currency than its account',
            (foodId) => ({
                accounts: [accountRecord('A')],
                recurringRules: [
                    { id: 'r1', title: 'R', type: 'expense', amount: 100, currency: 'EUR', accountId: 'A', categoryId: foodId, interval: 'monthly', nextDueDate: now },
                ],
            }),
        ],
        [
            'a rule match value over 200 characters',
            (foodId) => ({
                categorizationRules: [
                    { id: 'k1', name: 'K', matchType: 'description_contains', matchValue: 'x'.repeat(201), categoryId: foodId },
                ],
            }),
        ],
        [
            'a description rule with no match value',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'description_equals', categoryId: foodId }],
            }),
        ],
        [
            'an amount-range rule with no bounds',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'amount_range', categoryId: foodId }],
            }),
        ],
        [
            'an amount-range rule with min above max',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'amount_range', amountMin: 500, amountMax: 100, categoryId: foodId }],
            }),
        ],
        [
            'a fractional amount-range bound',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'amount_range', amountMin: 1.5, categoryId: foodId }],
            }),
        ],
        [
            'an account rule with no account',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'account_id', categoryId: foodId }],
            }),
        ],
        [
            'a rule with an unknown match type',
            (foodId) => ({
                categorizationRules: [{ id: 'k1', name: 'K', matchType: 'regex', matchValue: '.*', categoryId: foodId }],
            }),
        ],
        [
            'a fractional template amount',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactionTemplates: [{ id: 'm1', name: 'M', type: 'expense', amount: 5.5, accountId: 'A', categoryId: foodId }],
            }),
        ],
        [
            'a transfer template',
            (foodId) => ({
                accounts: [accountRecord('A')],
                transactionTemplates: [{ id: 'm1', name: 'M', type: 'transfer', amount: 500, accountId: 'A', categoryId: foodId }],
            }),
        ],
        ['a category with no name', (foodId) => ({ categories: [{ id: 'c1', name: ' ', masterCategoryId: foodId }] })],
        [
            'a custom category whose parent is another custom category',
            (foodId) => ({
                categories: [
                    { id: 'c1', name: 'One', masterCategoryId: foodId },
                    { id: 'c2', name: 'Two', masterCategoryId: 'c1' },
                ],
            }),
        ],
        ['a tag name over 50 characters', () => ({ tags: [{ id: 't1', name: 'x'.repeat(51) }] })],
    ]

    it.each(cases)('refuses %s and writes nothing', async (_label, build) => {
        const target = await seedUserDirectly({ email: `sec85-bounds-${Math.random().toString(36).slice(2)}@example.com` })
        const foodId = await getMasterId(target.token, 'Food')
        const payload = buildPayload(build(foodId))

        expect((await preview(target.token, payload)).body.data.valid).toBe(false)
        const res = await restore(target.token, payload)
        expect(res.status).toBe(400)
        await untouched(target.userId)
    })

    it('restores rules, templates and recurring rules that sit exactly on the bounds', async () => {
        const target = await seedUserDirectly({ email: 'sec85-edge@example.com' })
        const foodId = await getMasterId(target.token, 'Food')

        const res = await restore(
            target.token,
            buildPayload({
                accounts: [accountRecord('A')],
                categorizationRules: [
                    { id: 'k1', name: 'Long', matchType: 'description_contains', matchValue: 'x'.repeat(200), categoryId: foodId },
                    { id: 'k2', name: 'Range', matchType: 'amount_range', amountMin: 100, amountMax: 100, categoryId: foodId },
                ],
                transactionTemplates: [{ id: 'm1', name: 'M', type: 'expense', amount: 1, accountId: 'A', categoryId: foodId }],
                recurringRules: [
                    { id: 'r1', title: 'R', type: 'expense', amount: 1, currency: 'USD', accountId: 'A', categoryId: foodId, interval: 'custom', customIntervalDays: 1, nextDueDate: now },
                ],
            })
        )

        expect(res.status).toBe(201)
        expect(await CategorizationRule.countDocuments({ userId: target.userId })).toBe(2)
        expect(await TransactionTemplate.countDocuments({ userId: target.userId })).toBe(1)
        expect(await RecurringRule.countDocuments({ userId: target.userId })).toBe(1)
    })
})

describe('Backup restore - round trip keeps the fields users rely on (BUG-64)', () => {
    const seedSource = async (email: string) => {
        const source = await seedUserDirectly({ email })
        const foodId = await getMasterId(source.token, 'Food')

        const checking = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(source.token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 1000, isDefault: true })
        const card = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(source.token))
            .send({ name: 'Card', type: 'credit', openingBalance: 0, interestRate: 19.99, minimumPayment: 35.5 })
        expect(checking.body.data.isDefault).toBe(true)

        await RecurringRule.create({
            userId: source.userId,
            title: 'Cancelled streaming',
            type: 'expense',
            amount: 1299,
            currency: 'USD',
            accountId: checking.body.data._id,
            categoryId: foodId,
            interval: 'monthly',
            nextDueDate: new Date('2026-03-01T00:00:00.000Z'),
            isCancelled: true,
            isActive: false,
        })

        const base = {
            userId: source.userId,
            accountId: checking.body.data._id,
            categoryId: foodId,
            type: 'expense' as const,
            status: 'posted' as const,
            currency: 'USD',
        }
        await Transaction.create({
            ...base,
            title: 'Imported row',
            amount: 4200,
            date: new Date('2026-01-10T00:00:00.000Z'),
            clearedStatus: 'cleared',
            externalId: 'FITID-0001',
        })
        await Transaction.create({
            ...base,
            title: 'Reconciled row',
            amount: 800,
            date: new Date('2026-01-11T00:00:00.000Z'),
            clearedStatus: 'reconciled',
            reconciledAt: new Date('2026-02-01T09:30:00.000Z'),
        })

        const split = await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(source.token))
            .send({
                type: 'expense',
                title: 'Mixed trip',
                amount: 100,
                date: '2026-01-17T12:00:00.000Z',
                accountId: checking.body.data._id,
                splits: [
                    { categoryId: foodId, amount: 60 },
                    { categoryId: await getMasterId(source.token, 'Shopping'), amount: 40 },
                ],
            })
        expect(split.status).toBe(201)

        return source
    }

    it('keeps the default account, credit terms, cancelled state, reconciliation state, external id and split marker', async () => {
        const source = await seedSource('bug64-source@example.com')
        const target = await seedUserDirectly({ email: 'bug64-target@example.com' })

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const res = await restore(target.token, exportRes.body)
        expect(res.status).toBe(201)

        const accounts = await Account.find({ userId: target.userId }).lean()
        const checking = accounts.find((account) => account.name === 'Checking')
        const card = accounts.find((account) => account.name === 'Card')
        expect(checking?.isDefault).toBe(true)
        expect(card?.isDefault).toBe(false)
        expect(card?.interestRate).toBeCloseTo(19.99, 2)
        expect(card?.minimumPayment).toBeCloseTo(35.5, 2)

        const rule = await RecurringRule.findOne({ userId: target.userId, title: 'Cancelled streaming' })
        expect(rule?.isCancelled).toBe(true)
        expect(rule?.isActive).toBe(false)

        const imported = await Transaction.findOne({ userId: target.userId, title: 'Imported row' })
        expect(imported?.clearedStatus).toBe('cleared')
        expect(imported?.externalId).toBe('FITID-0001')

        const reconciled = await Transaction.findOne({ userId: target.userId, title: 'Reconciled row' })
        expect(reconciled?.clearedStatus).toBe('reconciled')
        expect(reconciled?.reconciledAt?.toISOString()).toBe('2026-02-01T09:30:00.000Z')

        const parent = await Transaction.findOne({ userId: target.userId, title: 'Mixed trip', splitTransactionId: null })
        expect(parent?.hasSplitChildren).toBe(true)
    })

    it('exports and restores every persisted transaction field unchanged', async () => {
        const source = await seedSource('bug64-diff-source@example.com')
        const target = await seedUserDirectly({ email: 'bug64-diff-target@example.com' })

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        expect((await restore(target.token, exportRes.body)).status).toBe(201)

        const pick = (row: Record<string, unknown>) => ({
            title: row.title,
            type: row.type,
            status: row.status,
            amount: row.amount,
            currency: row.currency,
            clearedStatus: row.clearedStatus,
            reconciledAt: row.reconciledAt ? new Date(row.reconciledAt as Date).toISOString() : null,
            externalId: row.externalId ?? null,
            hasSplitChildren: row.hasSplitChildren ?? false,
            date: new Date(row.date as Date).toISOString(),
        })
        const shape = async (userId: string) =>
            (await Transaction.find({ userId }).lean())
                .map((row) => JSON.stringify(pick(row as unknown as Record<string, unknown>)))
                .sort()

        expect(await shape(target.userId)).toEqual(await shape(source.userId))
    })

    it('does not break when the target already has a default account', async () => {
        const source = await seedSource('bug64-default-source@example.com')
        const target = await seedUserDirectly({ email: 'bug64-default-target@example.com' })
        const existing = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(target.token))
            .send({ name: 'Already here', type: 'checking', openingBalance: 5 })
        expect(existing.body.data.isDefault).toBe(true)

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const res = await restore(target.token, exportRes.body)

        expect(res.status).toBe(201)
        const defaults = await Account.find({ userId: target.userId, isDefault: true, isArchived: false })
        expect(defaults.map((account) => account.name)).toEqual(['Already here'])
        expect(res.body.data.warnings.join(' ')).toMatch(/default account/i)
    })

    it('restores a second copy without tripping the one-default-per-user index', async () => {
        const source = await seedSource('bug64-twice-source@example.com')
        const target = await seedUserDirectly({ email: 'bug64-twice-target@example.com' })
        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))

        expect((await restore(target.token, exportRes.body)).status).toBe(201)
        expect((await restore(target.token, exportRes.body)).status).toBe(201)

        expect(await Account.countDocuments({ userId: target.userId, isDefault: true, isArchived: false })).toBe(1)
    })

    it('never makes a workspace account the default', async () => {
        const source = await seedSource('bug64-ws-source@example.com')
        const workspaceRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(source.token))
            .send({ name: 'Shared' })
        const workspaceId = workspaceRes.body.data._id as string

        const exportRes = await request(app).get('/api/v1/backup/export').set(authHeader(source.token))
        const res = await request(app)
            .post('/api/v1/backup/restore')
            .set(authHeader(source.token))
            .send({ backup: exportRes.body, workspaceId })

        expect(res.status).toBe(201)
        expect(await Account.countDocuments({ workspaceId, isDefault: true })).toBe(0)
        expect(await Account.countDocuments({ workspaceId })).toBe(2)
    })
})
