import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import { authHeader, seedUserDirectly } from './helpers'

/**
 * Sprint 11.0 acceptance criteria for the debt payoff planner (11.4).
 *
 * Contract defined by these tests (implementation must satisfy):
 *   Account model gains optional `interestRate` (APR, percent, e.g. 24.99) and
 *   `minimumPayment` (major units) fields, settable only for type='credit' accounts via the
 *   existing POST /api/v1/accounts and PUT /api/v1/accounts/:id endpoints.
 *
 *   A credit account represents debt via a negative currentBalance; debt magnitude used by
 *   the planner is Math.abs(currentBalance) for accounts with currentBalance < 0. Credit
 *   accounts with currentBalance >= 0 (no debt) are excluded from the plan.
 *
 *   POST /api/v1/debts/plan
 *   body: { strategy: 'snowball'|'avalanche', extraPayment, accountIds?, workspaceId? }
 *   -> { success, data: { strategy, extraPayment, order: [accountId,...], totalMonths,
 *        totalInterestPaid, months: [{ month, payments: [{ accountId, paymentMinor?,
 *        interestPaid, principalPaid, remainingBalance }] }] } }
 *   (interestPaid/principalPaid/remainingBalance/payment are reported in major units)
 *
 *   Read-only: this endpoint performs a calculation only, no persisted resource and no
 *   auto-pay. Interest compounds monthly: interest = remainingBalance * (APR/100/12).
 */

async function createCreditAccount(
    token: string,
    overrides: {
        name?: string
        openingBalance?: number
        interestRate?: number
        minimumPayment?: number
        workspaceId?: string
    } = {}
) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({
            name: 'Credit card',
            type: 'credit',
            openingBalance: -1000,
            interestRate: 24,
            minimumPayment: 50,
            ...overrides,
        })
    return res.body.data
}

async function planPayoff(token: string, body: Record<string, unknown>) {
    return request(app).post('/api/v1/debts/plan').set(authHeader(token)).send(body)
}

describe('Account model - interestRate and minimumPayment fields', () => {
    it('accepts interestRate and minimumPayment on a credit account', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-account-create@example.com' })

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Visa', type: 'credit', openingBalance: -500, interestRate: 19.99, minimumPayment: 35 })

        expect(res.status).toBe(201)
        expect(res.body.data.interestRate).toBe(19.99)
        expect(res.body.data.minimumPayment).toBe(35)
        expect(res.body.data.currentBalance).toBe(-500)
    })

    it('rejects interestRate or minimumPayment on a non-credit account', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-account-non-credit@example.com' })

        const res = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 0, interestRate: 5 })

        expect(res.status).toBe(400)
    })

    it('updates interestRate and minimumPayment on an existing credit account', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-account-update@example.com' })
        const account = await createCreditAccount(token)

        const res = await request(app)
            .put(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))
            .send({ interestRate: 18, minimumPayment: 60 })

        expect(res.status).toBe(200)
        expect(res.body.data.interestRate).toBe(18)
        expect(res.body.data.minimumPayment).toBe(60)
    })
})

describe('Debt payoff planner - validation and auth', () => {
    it('rejects unauthenticated requests', async () => {
        const res = await request(app).post('/api/v1/debts/plan').send({ strategy: 'snowball', extraPayment: 0 })
        expect(res.status).toBe(401)
    })

    it('rejects an invalid strategy', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-bad-strategy@example.com' })
        await createCreditAccount(token)

        const res = await planPayoff(token, { strategy: 'bogus', extraPayment: 0 })
        expect(res.status).toBe(400)
    })

    it('rejects a negative extraPayment', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-negative-extra@example.com' })
        await createCreditAccount(token)

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: -10 })
        expect(res.status).toBe(400)
    })

    it('rejects a credit account missing interestRate or minimumPayment when included by id', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-missing-config@example.com' })

        const accountRes = await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Unconfigured card', type: 'credit', openingBalance: -200 })

        const res = await planPayoff(token, {
            strategy: 'snowball',
            extraPayment: 0,
            accountIds: [accountRes.body.data._id],
        })
        expect(res.status).toBe(400)
    })

    it('returns an empty plan when the user has no credit debt', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-none@example.com' })
        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Checking', type: 'checking', openingBalance: 500 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 100 })
        expect(res.status).toBe(200)
        expect(res.body.data.order).toEqual([])
        expect(res.body.data.totalMonths).toBe(0)
    })

    it('excludes non-credit and paid-off (non-negative balance) accounts', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-exclude@example.com' })
        await request(app)
            .post('/api/v1/accounts')
            .set(authHeader(token))
            .send({ name: 'Savings', type: 'savings', openingBalance: 500 })
        const paidOffCard = await createCreditAccount(token, { name: 'Paid off card', openingBalance: 0 })
        const activeDebt = await createCreditAccount(token, { name: 'Active card', openingBalance: -300 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 50 })
        expect(res.body.data.order).toEqual([activeDebt._id])
        expect(res.body.data.order).not.toContain(paidOffCard._id)
    })
})

describe('Debt payoff planner - ordering strategies', () => {
    it('orders debts by ascending balance for snowball regardless of APR', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-snowball-order@example.com' })
        const big = await createCreditAccount(token, { name: 'Big low-APR debt', openingBalance: -2000, interestRate: 5, minimumPayment: 40 })
        const small = await createCreditAccount(token, { name: 'Small high-APR debt', openingBalance: -500, interestRate: 25, minimumPayment: 20 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 100 })
        expect(res.body.data.order).toEqual([small._id, big._id])
    })

    it('orders debts by descending APR for avalanche regardless of balance', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-avalanche-order@example.com' })
        const highApr = await createCreditAccount(token, { name: 'High APR debt', openingBalance: -2000, interestRate: 20, minimumPayment: 40 })
        const lowApr = await createCreditAccount(token, { name: 'Low APR debt', openingBalance: -500, interestRate: 5, minimumPayment: 20 })

        const res = await planPayoff(token, { strategy: 'avalanche', extraPayment: 100 })
        expect(res.body.data.order).toEqual([highApr._id, lowApr._id])
    })
})

describe('Debt payoff planner - schedule calculations', () => {
    it('computes an exact payoff timeline for a single 0% APR debt', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-zero-apr@example.com' })
        await createCreditAccount(token, { name: 'Zero APR card', openingBalance: -300, interestRate: 0, minimumPayment: 50 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 50 })
        expect(res.status).toBe(200)
        // $100/mo total payment against $300 balance with no interest => exactly 3 months
        expect(res.body.data.totalMonths).toBe(3)
        expect(res.body.data.totalInterestPaid).toBe(0)

        const lastMonth = res.body.data.months[res.body.data.months.length - 1]
        expect(lastMonth.payments[0].remainingBalance).toBe(0)
    })

    it('pays off a single debt in one month when the payment covers balance plus interest', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-one-shot@example.com' })
        // 12% APR => 1%/month interest on $1000 = $10; minimumPayment covers principal + interest exactly
        await createCreditAccount(token, { name: 'One shot card', openingBalance: -1000, interestRate: 12, minimumPayment: 1010 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 0 })
        expect(res.body.data.totalMonths).toBe(1)
        expect(res.body.data.totalInterestPaid).toBeCloseTo(10, 2)
        expect(res.body.data.months[0].payments[0].remainingBalance).toBe(0)
    })

    it('rolls a paid-off debt minimum payment into the next target under snowball', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-rollover@example.com' })
        const small = await createCreditAccount(token, { name: 'Small debt', openingBalance: -100, interestRate: 0, minimumPayment: 25 })
        const large = await createCreditAccount(token, { name: 'Large debt', openingBalance: -1000, interestRate: 0, minimumPayment: 50 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 25 })
        expect(res.status).toBe(200)
        expect(res.body.data.order).toEqual([small._id, large._id])
        // small: (25 min + 25 extra) = $50/mo => paid off in 2 months
        // large: $50/mo for 2 months (900 remaining), then 50+50(rolled)=$100/mo for 9 more months => 11 total
        expect(res.body.data.totalMonths).toBe(11)
        expect(res.body.data.totalInterestPaid).toBe(0)

        const month2 = res.body.data.months[1]
        const smallPaymentMonth2 = month2.payments.find((p: { accountId: string }) => p.accountId === small._id)
        expect(smallPaymentMonth2.remainingBalance).toBe(0)
    })

    it('reports increasing totalInterestPaid across months for a debt with positive APR', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-interest-accrual@example.com' })
        await createCreditAccount(token, { name: 'Interest card', openingBalance: -1000, interestRate: 24, minimumPayment: 50 })

        const res = await planPayoff(token, { strategy: 'avalanche', extraPayment: 0 })
        expect(res.status).toBe(200)
        expect(res.body.data.totalInterestPaid).toBeGreaterThan(0)
        expect(res.body.data.months[0].payments[0].interestPaid).toBeCloseTo(20, 2)
    })

    it('rejects a plan where the minimum payment cannot cover monthly interest (negative amortization)', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-negative-amortization@example.com' })
        // 50% APR => ~4.17%/month interest on $1000 = ~$41.67, minimumPayment of $10 never reduces the balance
        await createCreditAccount(token, { name: 'Runaway card', openingBalance: -1000, interestRate: 50, minimumPayment: 10 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 0 })
        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/minimum payment|interest|cannot be paid off/i)
    })
})

describe('Debt payoff planner - scoping', () => {
    it('limits the plan to accountIds when provided', async () => {
        const { token } = await seedUserDirectly({ email: 'debt-scoped@example.com' })
        const included = await createCreditAccount(token, { name: 'Included debt', openingBalance: -300 })
        const excluded = await createCreditAccount(token, { name: 'Excluded debt', openingBalance: -400 })

        const res = await planPayoff(token, { strategy: 'snowball', extraPayment: 0, accountIds: [included._id] })
        expect(res.body.data.order).toEqual([included._id])
        expect(res.body.data.order).not.toContain(excluded._id)
    })

    it('rejects planning against another user credit account', async () => {
        const owner = await seedUserDirectly({ email: 'debt-owner@example.com' })
        const other = await seedUserDirectly({ email: 'debt-other@example.com' })
        const ownerAccount = await createCreditAccount(owner.token)

        const res = await planPayoff(other.token, {
            strategy: 'snowball',
            extraPayment: 0,
            accountIds: [ownerAccount._id],
        })
        expect(res.status).toBe(403)
    })

    it('only includes workspace credit accounts for workspace members', async () => {
        const owner = await seedUserDirectly({ email: 'debt-ws-owner@example.com' })

        const wsRes = await request(app)
            .post('/api/v1/workspaces')
            .set(authHeader(owner.token))
            .send({ name: 'Household' })
        const workspaceId = wsRes.body.data._id

        const wsAccount = await createCreditAccount(owner.token, { name: 'Shared card', openingBalance: -300, workspaceId })
        const personalAccount = await createCreditAccount(owner.token, { name: 'Personal card', openingBalance: -400 })

        const res = await planPayoff(owner.token, { strategy: 'snowball', extraPayment: 0, workspaceId })
        expect(res.body.data.order).toContain(wsAccount._id)
        expect(res.body.data.order).not.toContain(personalAccount._id)
    })
})

describe('debtPayoffUtils', () => {
    it('orders debts by ascending balance for snowball', async () => {
        const { orderDebtsBySnowball } = await import('../utils/debtPayoffUtils')

        const ordered = orderDebtsBySnowball([
            { accountId: 'a', balanceMinor: 200000, interestRate: 5, minimumPaymentMinor: 4000 },
            { accountId: 'b', balanceMinor: 50000, interestRate: 25, minimumPaymentMinor: 2000 },
        ] as never)

        expect(ordered.map((d: { accountId: string }) => d.accountId)).toEqual(['b', 'a'])
    })

    it('orders debts by descending interest rate for avalanche', async () => {
        const { orderDebtsByAvalanche } = await import('../utils/debtPayoffUtils')

        const ordered = orderDebtsByAvalanche([
            { accountId: 'a', balanceMinor: 200000, interestRate: 5, minimumPaymentMinor: 4000 },
            { accountId: 'b', balanceMinor: 50000, interestRate: 25, minimumPaymentMinor: 2000 },
        ] as never)

        expect(ordered.map((d: { accountId: string }) => d.accountId)).toEqual(['b', 'a'])
    })

    it('generates a payoff schedule for a single zero-interest debt', async () => {
        const { generatePayoffSchedule } = await import('../utils/debtPayoffUtils')

        const plan = generatePayoffSchedule(
            [{ accountId: 'a', balanceMinor: 30000, interestRate: 0, minimumPaymentMinor: 5000 }] as never,
            5000,
            'snowball'
        )

        expect(plan.totalMonths).toBe(3)
        expect(plan.totalInterestMinor).toBe(0)
    })
})
