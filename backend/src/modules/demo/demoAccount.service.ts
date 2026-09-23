import { Account } from '@modules/accounts'
import { recomputeAccountBalanceMajor } from '@modules/accounts/accountBalance'
import { Budget } from '@modules/budgets'
import { Category } from '@modules/categories'
import { ensureMasterCategoriesSeeded } from '@modules/categories/categorySeed'
import { SavingsGoal } from '@modules/savings-goals'
import { Subscription } from '@modules/billing'
import { Transaction, type TransactionType } from '@modules/transactions'
import { User, type IUser } from '@modules/users'
import { CURRENT_LEGAL_VERSIONS } from '@modules/users/legalVersions'
import { resolveMonthlyPeriod } from '@shared/budget'
import { toMinorUnits } from '@shared/money'

/**
 * M9 - the shared, public, read-only demo account. Real credentials by design (the whole point is
 * a "View demo" link anyone can use), so both sides default to the same literal value; an operator
 * who wants a different pair sets both `DEMO_ACCOUNT_EMAIL`/`DEMO_ACCOUNT_PASSWORD` here and the
 * matching `VITE_DEMO_EMAIL`/`VITE_DEMO_PASSWORD` on the frontend build.
 */
export const DEFAULT_DEMO_EMAIL = 'demo@corvale.app'
export const DEFAULT_DEMO_PASSWORD = 'CorvaleDemo!2026'

export const getDemoAccountEmail = (): string => process.env.DEMO_ACCOUNT_EMAIL?.trim() || DEFAULT_DEMO_EMAIL
export const getDemoAccountPassword = (): string => process.env.DEMO_ACCOUNT_PASSWORD || DEFAULT_DEMO_PASSWORD

// Far enough out it never needs bumping; see the comment on `upsertDemoSubscription` for why this exists.
const RETENTION_HOLD_FOREVER = new Date('9999-12-31T00:00:00.000Z')

export interface DemoSeedResult {
    userId: string
    email: string
    accountsCreated: number
    transactionsCreated: number
    budgetsCreated: number
    savingsGoalsCreated: number
}

const upsertDemoUser = async (now: Date): Promise<IUser> => {
    const email = getDemoAccountEmail()
    const password = getDemoAccountPassword()

    let user = await User.findOne({ email })
    if (!user) {
        user = new User({ fullName: 'Corvale Demo', email, password })
    } else if (!(await user.comparePassword(password))) {
        user.password = password
    }

    user.isEmailVerified = true
    user.onboardingStarted = true
    user.onboardingCompleted = true
    user.onboardingSkipped = true
    user.legalAcceptance = {
        termsVersion: CURRENT_LEGAL_VERSIONS.termsVersion,
        privacyVersion: CURRENT_LEGAL_VERSIONS.privacyVersion,
        acceptedAt: now,
        ageAttested: true,
    }
    await user.save()
    return user
}

/**
 * Read-only enforcement is the existing trial-expired/past-due gate (`core/billing/readOnlyReason.ts`
 * via `entitlement.middleware.ts`), not a new path: a `cancelled` subscription already makes
 * `canWrite` false. The only demo-specific wrinkle is `retentionHoldUntil` - without it, `cancelled`
 * puts this row in `LAPSED_STATUSES` and the nightly retention sweep (when an operator enables it)
 * would eventually dun and erase the demo account like a real churned customer. A far-future hold
 * keeps `retention.service.ts`'s `notPaused()` excluding it forever, using a field that already
 * exists for exactly this purpose (an admin-initiated pause) rather than a bespoke "is this the
 * demo account" branch. `grandfatherKind` must stay `null`: `free_forever` would force `canWrite`
 * back to `true`, defeating the whole point.
 */
const upsertDemoSubscription = async (userId: string): Promise<void> => {
    await Subscription.findOneAndUpdate(
        { userId },
        {
            $set: {
                planCode: 'pro',
                status: 'cancelled',
                interval: null,
                trialEndsAt: null,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                pastDueSince: null,
                dunningStage: null,
                retentionStage: null,
                retentionStageAt: null,
                grandfatherKind: null,
                adminGrant: null,
                retentionHoldUntil: RETENTION_HOLD_FOREVER,
                providerCustomerId: null,
                providerSubscriptionId: null,
                lastEventAt: null,
            },
            $setOnInsert: { userId },
        },
        { upsert: true }
    )
}

const wipeDemoData = async (userId: string): Promise<void> => {
    await Promise.all([
        Account.deleteMany({ userId }),
        Transaction.deleteMany({ userId }),
        Budget.deleteMany({ userId }),
        SavingsGoal.deleteMany({ userId }),
    ])
}

interface SeedAccountDefinition {
    key: 'checking' | 'savings' | 'credit'
    name: string
    type: 'checking' | 'savings' | 'credit'
    openingBalance: number
}

const ACCOUNT_DEFINITIONS: SeedAccountDefinition[] = [
    { key: 'checking', name: 'Everyday Checking', type: 'checking', openingBalance: 1200 },
    { key: 'savings', name: 'Emergency Savings', type: 'savings', openingBalance: 4500 },
    { key: 'credit', name: 'Rewards Credit Card', type: 'credit', openingBalance: 0 },
]

interface TransactionTemplate {
    dayOfMonth: number
    type: TransactionType
    account: SeedAccountDefinition['key']
    category: string
    title: string
    amount: number
}

// One recurring pattern, replayed over the last three calendar months (clipped to `now`) so a
// nightly reseed always looks current rather than frozen on the day this file was written.
const MONTHLY_PATTERN: TransactionTemplate[] = [
    { dayOfMonth: 1, type: 'income', account: 'checking', category: 'Income', title: 'Paycheck', amount: 2100 },
    { dayOfMonth: 16, type: 'income', account: 'checking', category: 'Income', title: 'Paycheck', amount: 2100 },
    { dayOfMonth: 3, type: 'expense', account: 'checking', category: 'Housing', title: 'Rent', amount: 950 },
    { dayOfMonth: 5, type: 'expense', account: 'checking', category: 'Food', title: 'Groceries', amount: 68.42 },
    { dayOfMonth: 12, type: 'expense', account: 'checking', category: 'Food', title: 'Groceries', amount: 74.15 },
    { dayOfMonth: 19, type: 'expense', account: 'checking', category: 'Food', title: 'Groceries', amount: 61.9 },
    { dayOfMonth: 26, type: 'expense', account: 'checking', category: 'Food', title: 'Groceries', amount: 70.33 },
    { dayOfMonth: 8, type: 'expense', account: 'checking', category: 'Transport', title: 'Transit pass', amount: 45 },
    { dayOfMonth: 22, type: 'expense', account: 'checking', category: 'Transport', title: 'Gas', amount: 38.6 },
    { dayOfMonth: 14, type: 'expense', account: 'credit', category: 'Entertainment', title: 'Streaming + movie night', amount: 32.5 },
    { dayOfMonth: 20, type: 'expense', account: 'credit', category: 'Shopping', title: 'Online order', amount: 54.99 },
    { dayOfMonth: 9, type: 'expense', account: 'checking', category: 'Health', title: 'Pharmacy', amount: 24.75 },
]

const MONTHS_OF_HISTORY = 3

const buildTransactionDates = (now: Date): Array<{ date: Date; template: TransactionTemplate }> => {
    const entries: Array<{ date: Date; template: TransactionTemplate }> = []

    for (let monthsAgo = MONTHS_OF_HISTORY - 1; monthsAgo >= 0; monthsAgo -= 1) {
        const monthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1))
        const year = monthDate.getUTCFullYear()
        const month = monthDate.getUTCMonth()

        for (const template of MONTHLY_PATTERN) {
            const date = new Date(Date.UTC(year, month, template.dayOfMonth, 12))
            if (date.getTime() > now.getTime()) continue
            entries.push({ date, template })
        }
    }

    return entries
}

/**
 * Wipes and rebuilds every dashboard-visible record for the shared demo user: fresh accounts,
 * ~3 months of transactions ending "today" (so a nightly reseed never looks stale), a couple of
 * budgets, and one savings goal. Idempotent - safe to invoke nightly from an external scheduler,
 * the same way `sweepBilling.ts` is (see `scripts/seedDemoAccount.ts`).
 */
export const seedDemoAccount = async (now: Date = new Date()): Promise<DemoSeedResult> => {
    const user = await upsertDemoUser(now)
    const userId = user._id.toString()

    await wipeDemoData(userId)
    await ensureMasterCategoriesSeeded()
    await upsertDemoSubscription(userId)

    const masterCategories = await Category.find({ userId: null }).select('name').lean()
    const categoryIdByName = new Map(masterCategories.map((category) => [category.name, category._id]))
    const requireCategoryId = (name: string) => {
        const id = categoryIdByName.get(name)
        if (!id) throw new Error(`Master category "${name}" is missing - run ensureMasterCategoriesSeeded first`)
        return id
    }

    const accountDocs = await Account.create(
        ACCOUNT_DEFINITIONS.map((definition) => ({
            userId,
            name: definition.name,
            type: definition.type,
            openingBalance: definition.openingBalance,
            currentBalance: definition.openingBalance,
        }))
    )
    const accountIdByKey = new Map(accountDocs.map((account, index) => [ACCOUNT_DEFINITIONS[index].key, account]))

    const transactionEntries = buildTransactionDates(now)
    if (transactionEntries.length > 0) {
        await Transaction.create(
            transactionEntries.map(({ date, template }) => {
                const account = accountIdByKey.get(template.account)
                if (!account) throw new Error(`Unknown demo account key "${template.account}"`)
                return {
                    userId,
                    accountId: account._id,
                    categoryId: requireCategoryId(template.category),
                    type: template.type,
                    status: 'posted' as const,
                    amount: toMinorUnits(template.amount),
                    currency: 'USD',
                    title: template.title,
                    date,
                }
            })
        )
    }

    for (const account of accountDocs) {
        const currentBalance = await recomputeAccountBalanceMajor(account, userId)
        await Account.updateOne({ _id: account._id }, { $set: { currentBalance } })
    }

    const currentMonth = resolveMonthlyPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1, 'UTC')
    const budgetDocs = await Budget.create([
        {
            userId,
            name: 'Food',
            periodType: 'monthly' as const,
            ...currentMonth,
            categoryId: requireCategoryId('Food'),
            amount: 400,
            currency: 'USD',
        },
        {
            userId,
            name: 'Entertainment',
            periodType: 'monthly' as const,
            ...currentMonth,
            categoryId: requireCategoryId('Entertainment'),
            amount: 150,
            currency: 'USD',
        },
    ])

    const savingsAccount = accountIdByKey.get('savings')
    const savingsGoalDocs = await SavingsGoal.create([
        {
            userId,
            name: 'Emergency Fund',
            targetAmount: 10000,
            currentAmount: 4500,
            currency: 'USD',
            targetDate: new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1)),
            status: 'active' as const,
            accountId: savingsAccount?._id ?? null,
        },
    ])

    return {
        userId,
        email: user.email,
        accountsCreated: accountDocs.length,
        transactionsCreated: transactionEntries.length,
        budgetsCreated: budgetDocs.length,
        savingsGoalsCreated: savingsGoalDocs.length,
    }
}
