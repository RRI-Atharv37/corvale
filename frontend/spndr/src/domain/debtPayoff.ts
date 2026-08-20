import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { generatePayoffSchedule, type DebtInput, type PayoffMonth, type PayoffStrategy } from '@shared/debtPayoff'
import { toMinorUnits } from '@shared/money'
import type { LocalAccount } from './types'

export type { PayoffStrategy } from '@shared/debtPayoff'

/** `LocalAccount` (domain/types.ts) has no `interestRate`/`minimumPayment` fields yet - they
 * round-trip fine through the JSON `data` blob (Repository stores the full doc), this just widens
 * the local type so this module can read them, mirroring the pattern established in
 * `pages/Dashboard/hooks/useAccountsData.ts`. */
interface LocalAccountRecord extends LocalAccount {
  interestRate?: number
  minimumPayment?: number
}

const accountsRepo = new Repository<LocalAccountRecord>('accounts')

export interface DebtPayoffLocalOptions {
  strategy: PayoffStrategy
  extraPayment: number
  accountIds?: string[]
  workspaceId?: string | null
}

export interface LocalDebtPayoffPlan {
  strategy: PayoffStrategy
  extraPayment: number
  order: string[]
  totalMonths: number
  totalInterestPaid: number
  months: PayoffMonth[]
}

const isEligibleDebtAccount = (account: LocalAccountRecord): boolean =>
  account.type === 'credit' && account.currentBalance < 0

const buildDebtInput = (account: LocalAccountRecord): DebtInput => {
  if (account.interestRate === undefined || account.minimumPayment === undefined) {
    throw new Error(
      `Account "${account.name}" must have interestRate and minimum payment configured before planning payoff`
    )
  }

  return {
    accountId: account._id,
    balanceMinor: toMinorUnits(Math.abs(account.currentBalance)),
    interestRate: account.interestRate,
    minimumPaymentMinor: toMinorUnits(account.minimumPayment),
  }
}

/** Local counterpart to `POST /debts/plan`. Throws a plain `Error` (same as `generatePayoffSchedule`
 * itself) when a debt cannot be paid off with the given payments - callers (the page, via
 * `getApiErrorMessage`) already treat a thrown `Error`'s `.message` the same as a server 400. */
export const computeLocalDebtPayoffPlan = async (
  db: LocalDb,
  options: DebtPayoffLocalOptions
): Promise<LocalDebtPayoffPlan> => {
  const { strategy, extraPayment } = options

  if (isNaN(extraPayment) || extraPayment < 0) {
    throw new Error('Invalid extraPayment; must be a non-negative number')
  }

  const workspaceId = options.workspaceId ?? null
  const allAccounts = await accountsRepo.list(db)

  let accounts: LocalAccountRecord[]
  if (options.accountIds && options.accountIds.length > 0) {
    const byId = new Map(allAccounts.map((account) => [account._id, account]))
    accounts = options.accountIds
      .map((id) => {
        const account = byId.get(id)
        if (!account) {
          throw new Error('Account not found')
        }
        return account
      })
      .filter(isEligibleDebtAccount)
  } else {
    accounts = allAccounts.filter(
      (account) =>
        !account.isArchived &&
        account.type === 'credit' &&
        account.currentBalance < 0 &&
        (workspaceId ? account.workspaceId === workspaceId : !account.workspaceId)
    )
  }

  const debts = accounts.map(buildDebtInput)
  const extraPaymentMinor = toMinorUnits(extraPayment)

  if (debts.length === 0) {
    return { strategy, extraPayment, order: [], totalMonths: 0, totalInterestPaid: 0, months: [] }
  }

  const plan = generatePayoffSchedule(debts, extraPaymentMinor, strategy)

  return {
    strategy,
    extraPayment,
    order: plan.order,
    totalMonths: plan.totalMonths,
    totalInterestPaid: plan.totalInterestPaid,
    months: plan.months,
  }
}
