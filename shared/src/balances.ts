import { AccountType, TransactionStatus, TransactionType } from './types'
import { getBalanceDeltaMajor, roundMoney } from './money'
import { convertAmount } from './timezone'

const ASSET_ACCOUNT_TYPES: AccountType[] = ['checking', 'cash', 'savings']
const LIQUID_ACCOUNT_TYPES: AccountType[] = ['checking', 'cash']

export interface AccountLike {
    type: AccountType
    currentBalance: number
    currency: string
    isArchived: boolean
}

export interface AccountTotals {
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
}

export interface UserBalanceSummary {
    totalIncome: number
    totalExpenses: number
    saverBalance: number
    spendableBalance: number
    netWorth: number
    totalAccountBalance: number
    liquidBalance: number
    accountCount: number
    balanceSource: 'accounts' | 'legacy'
}

export interface CurrencyConversionOptions {
    preferredCurrency: string
    exchangeRates: Record<string, number>
}

export const computeAccountTotalsPure = (
    accounts: AccountLike[],
    conversion?: CurrencyConversionOptions
): AccountTotals => {
    const activeAccounts = accounts.filter((account) => !account.isArchived)

    let assetTotal = 0
    let creditTotal = 0
    let liquidBalance = 0

    for (const account of activeAccounts) {
        const rawBalance = roundMoney(account.currentBalance)
        const balance = conversion
            ? roundMoney(
                  convertAmount(rawBalance, account.currency, conversion.preferredCurrency, conversion.exchangeRates)
              )
            : rawBalance

        if (account.type === 'credit') {
            creditTotal = roundMoney(creditTotal + balance)
        } else if (ASSET_ACCOUNT_TYPES.includes(account.type)) {
            assetTotal = roundMoney(assetTotal + balance)
        }

        if (LIQUID_ACCOUNT_TYPES.includes(account.type)) {
            liquidBalance = roundMoney(liquidBalance + balance)
        }
    }

    return {
        totalAccountBalance: roundMoney(assetTotal - creditTotal),
        liquidBalance,
        accountCount: activeAccounts.length,
    }
}

export interface UserBalancesPureParams {
    accounts: AccountLike[]
    totalIncomeMajor: number
    totalExpensesMajor: number
    saverBalanceMajor: number
    workspaceId?: string | null
    conversion?: CurrencyConversionOptions
}

/**
 * Pre-Phase-1c bridge, preserved verbatim: when active accounts exist, net
 * worth and spendable derive from account balances. Income/expense totals
 * remain activity metrics only for the legacy (no-accounts) path.
 */
export const computeUserBalancesPure = (params: UserBalancesPureParams): UserBalanceSummary => {
    const accountTotals = computeAccountTotalsPure(params.accounts, params.conversion)

    if (params.workspaceId) {
        return {
            totalIncome: 0,
            totalExpenses: 0,
            saverBalance: 0,
            spendableBalance: accountTotals.liquidBalance,
            netWorth: accountTotals.totalAccountBalance,
            totalAccountBalance: accountTotals.totalAccountBalance,
            liquidBalance: accountTotals.liquidBalance,
            accountCount: accountTotals.accountCount,
            balanceSource: 'accounts',
        }
    }

    const totalIncome = roundMoney(params.totalIncomeMajor)
    const totalExpenses = roundMoney(params.totalExpensesMajor)
    const saverBalance = roundMoney(params.saverBalanceMajor)

    if (accountTotals.accountCount > 0) {
        const netWorth = accountTotals.totalAccountBalance
        const spendableBalance = roundMoney(Math.max(0, accountTotals.liquidBalance - saverBalance))

        return {
            totalIncome,
            totalExpenses,
            saverBalance,
            spendableBalance,
            netWorth,
            totalAccountBalance: accountTotals.totalAccountBalance,
            liquidBalance: accountTotals.liquidBalance,
            accountCount: accountTotals.accountCount,
            balanceSource: 'accounts',
        }
    }

    const netWorth = roundMoney(totalIncome - totalExpenses)
    const spendableBalance = roundMoney(Math.max(0, netWorth - saverBalance))

    return {
        totalIncome,
        totalExpenses,
        saverBalance,
        spendableBalance,
        netWorth,
        totalAccountBalance: 0,
        liquidBalance: 0,
        accountCount: 0,
        balanceSource: 'legacy',
    }
}

export interface RecomputeAccountLike {
    type: AccountType
    /** Either field is accepted as the base balance to recompute from. */
    openingBalance?: number
    currentBalance?: number
    /**
     * When set, only transactions dated on/after this instant contribute to the
     * recomputed balance — the opening balance is stated "as of" this date.
     * Omitted/null keeps the legacy behavior (every transaction counts). An
     * unparseable value is ignored (treated as null) rather than dropping every
     * transaction.
     */
    openingBalanceDate?: Date | string | number | null
}

export interface RecomputeTransactionLike {
    type: TransactionType
    amount: number
    /** Missing status is treated as 'posted' (drafts must be excluded explicitly). */
    status?: TransactionStatus
    /** Missing/undefined is treated as null (not a split child). */
    splitTransactionId?: string | null
    /**
     * Transaction date. Only consulted when the account carries an
     * `openingBalanceDate`; a missing date there is treated as on/after the
     * cutoff (kept) so real data is never silently dropped.
     */
    date?: Date | string | number | null
}

/**
 * Recomputes an account balance from scratch: opening balance plus every
 * posted, non-split-child transaction's delta. No existing equivalent
 * elsewhere in the codebase — balances have only ever been maintained
 * incrementally. Used to heal drift after offline replay (Sprint 13.2+).
 *
 * When `account.openingBalanceDate` is set, transactions dated before it are
 * excluded: the opening balance already represents the account's state as of
 * that date, so older history is informational only (reports, trends) and must
 * not move `currentBalance`.
 */
export const recomputeAccountBalance = (
    account: RecomputeAccountLike,
    transactions: RecomputeTransactionLike[]
): number => {
    const openingBalance = account.openingBalance ?? account.currentBalance ?? 0

    let cutoff: number | null = null
    if (account.openingBalanceDate != null) {
        const parsed = new Date(account.openingBalanceDate).getTime()
        cutoff = Number.isNaN(parsed) ? null : parsed
    }

    const delta = transactions
        .filter((tx) => (tx.status ?? 'posted') === 'posted')
        .filter((tx) => (tx.splitTransactionId ?? null) === null)
        .filter((tx) => {
            if (cutoff === null || tx.date == null) {
                return true
            }
            const txTime = new Date(tx.date).getTime()
            return Number.isNaN(txTime) || txTime >= cutoff
        })
        .reduce((sum, tx) => sum + getBalanceDeltaMajor(tx.type, tx.amount, account.type), 0)

    return roundMoney(openingBalance + delta)
}
