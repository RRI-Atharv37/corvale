import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../app'
import Account from '../models/Account'
import { toMinorUnits } from '../../shared/src/money'
import { computeUserBalances, computeAccountTotals } from '../utils/balanceUtils'
// migrateAccountBalancesToMinorUnits does not exist yet - it is Sprint C5's deliverable
// (ROADMAP.md "Account balance minor units", BUGS.md / TODO.md item C5). This acceptance
// suite (T3) defines what C5 must satisfy: Account.openingBalance/currentBalance move from
// major-unit floats to integer minor units, exactly mirroring the storage format Transaction.amount
// already uses (see moneyUtils.ts / migrateLegacyTransactions.ts for the established pattern this
// migration should follow). The API contract (request/response bodies) stays major-unit floats
// throughout - only the internal Account document representation changes.
import { migrateAccountBalancesToMinorUnits } from '../utils/migrateAccountBalancesToMinorUnits'
import { authHeader, seedUserDirectly } from './helpers'

async function createTestAccount(
    token: string,
    overrides: { name?: string; type?: string; openingBalance?: number } = {}
) {
    const res = await request(app)
        .post('/api/v1/accounts')
        .set(authHeader(token))
        .send({
            name: overrides.name ?? 'Test Account',
            type: overrides.type ?? 'checking',
            openingBalance: overrides.openingBalance ?? 0,
        })

    return res.body.data
}

describe('migrateAccountBalancesToMinorUnits', () => {
    it('converts openingBalance and currentBalance to integer minor units', async () => {
        const { token } = await seedUserDirectly({ email: 'minor-basic@example.com' })
        const account = await createTestAccount(token, { openingBalance: 123.45 })

        const result = await migrateAccountBalancesToMinorUnits()

        expect(result.accountsMigrated).toBe(1)
        expect(result.accountsSkipped).toBe(0)
        expect(result.dryRun).toBe(false)

        const migrated = await Account.findById(account._id)
        expect(migrated?.openingBalance).toBe(12345)
        expect(migrated?.currentBalance).toBe(12345)
        expect(Number.isInteger(migrated?.currentBalance)).toBe(true)
    })

    it.each([19.99, 0.1, 100.1, 0, -45.67, 3.3, 10.005])(
        // 10.005 is not exactly representable in binary float; the migration must round it exactly
        // the same way toMinorUnits/roundMoney already do everywhere else, or a rounding drift
        // appears between the two representations - that is the parity this test guards.
        'converts a tricky float balance %f to the same minor-unit integer toMinorUnits would produce',
        async (major) => {
            const { token } = await seedUserDirectly({ email: `minor-precision-${major}@example.com` })
            const account = await createTestAccount(token, { openingBalance: major, type: 'credit' })

            await migrateAccountBalancesToMinorUnits()

            const migrated = await Account.findById(account._id)
            expect(migrated?.currentBalance).toBe(toMinorUnits(major))
        }
    )

    it('is idempotent - a second run does not re-convert an already-migrated account', async () => {
        const { token } = await seedUserDirectly({ email: 'minor-idempotent@example.com' })
        const account = await createTestAccount(token, { openingBalance: 50 })

        const first = await migrateAccountBalancesToMinorUnits()
        expect(first.accountsMigrated).toBe(1)

        const afterFirst = await Account.findById(account._id)
        expect(afterFirst?.currentBalance).toBe(5000)

        const second = await migrateAccountBalancesToMinorUnits()
        expect(second.accountsMigrated).toBe(0)
        expect(second.accountsSkipped).toBe(1)

        const afterSecond = await Account.findById(account._id)
        expect(afterSecond?.currentBalance).toBe(5000) // not 500000 - a re-run must not multiply by 100 again
    })

    it('dry run reports counts without persisting any change', async () => {
        const { token } = await seedUserDirectly({ email: 'minor-dry-run@example.com' })
        const account = await createTestAccount(token, { openingBalance: 75.25 })

        const result = await migrateAccountBalancesToMinorUnits({ dryRun: true })

        expect(result.dryRun).toBe(true)
        expect(result.accountsMigrated).toBe(1)

        const untouched = await Account.findById(account._id)
        expect(untouched?.currentBalance).toBe(75.25)
    })

    it('parity: computeUserBalances returns identical figures before and after migration', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'minor-parity-user@example.com' })
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 1234.56 })
        await createTestAccount(token, { name: 'Credit Card', type: 'credit', openingBalance: 89.01 })

        const before = await computeUserBalances(userId)

        await migrateAccountBalancesToMinorUnits()

        const after = await computeUserBalances(userId)

        expect(after).toEqual(before)
    })

    it('parity: computeAccountTotals returns identical figures before and after migration', async () => {
        const { token, userId } = await seedUserDirectly({ email: 'minor-parity-totals@example.com' })
        await createTestAccount(token, { name: 'Checking', type: 'checking', openingBalance: 555.55 })
        await createTestAccount(token, { name: 'Savings', type: 'savings', openingBalance: 42.1 })

        const before = await computeAccountTotals(userId)
        await migrateAccountBalancesToMinorUnits()
        const after = await computeAccountTotals(userId)

        expect(after).toEqual(before)
    })

    it('a transaction posted after migration still updates currentBalance by the correct amount, surfaced correctly through the API', async () => {
        const { token } = await seedUserDirectly({ email: 'minor-post-migration-tx@example.com' })
        const account = await createTestAccount(token, { openingBalance: 200 })

        await migrateAccountBalancesToMinorUnits()

        const categoriesRes = await request(app).get('/api/v1/categories').set(authHeader(token))
        const foodCategoryId = categoriesRes.body.data.masters.find(
            (m: { name: string }) => m.name === 'Food'
        )._id

        await request(app)
            .post('/api/v1/transactions')
            .set(authHeader(token))
            .send({
                type: 'expense',
                title: 'Groceries',
                amount: 45.25,
                date: '2026-01-01T12:00:00.000Z',
                accountId: account._id,
                categoryId: foodCategoryId,
            })

        const getRes = await request(app)
            .get(`/api/v1/accounts/${account._id}`)
            .set(authHeader(token))

        // The API contract is unchanged by C5: currentBalance is still a major-unit
        // decimal on the wire, regardless of how it is now stored internally.
        expect(getRes.body.data.currentBalance).toBeCloseTo(154.75, 2)
    })
})
