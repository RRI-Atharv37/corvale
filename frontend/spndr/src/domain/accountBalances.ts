import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { recomputeAccountBalance as sharedRecomputeAccountBalance } from '@shared/balances'
import type { LocalAccount, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const toRecomputeTransactions = (transactions: LocalTransaction[], accountId: string) =>
  transactions
    .filter((tx) => tx.accountId === accountId)
    .map((tx) => ({
      type: tx.type,
      amount: tx.amount,
      status: tx.status,
      splitTransactionId: tx.splitTransactionId,
    }))

/** Recomputes one account's balance from its opening balance plus every posted, non-split-child local transaction. */
export const recomputeLocalAccountBalance = async (db: LocalDb, accountId: string): Promise<number> => {
  const account = await accountsRepo.findById(db, accountId)
  if (!account) {
    throw new Error(`Account ${accountId} not found locally`)
  }
  const transactions = await transactionsRepo.list(db)
  return sharedRecomputeAccountBalance(
    { type: account.type, openingBalance: account.openingBalance, currentBalance: account.currentBalance },
    toRecomputeTransactions(transactions, account._id)
  )
}

/**
 * Recomputes every local account's balance in one pass and persists the
 * result back into `accounts.currentBalance` (promoted column + `data`
 * blob), without touching `updatedAt` (server-authoritative, used for sync
 * ordering) or the dirty/sync-state columns (balance is a derived value,
 * never itself pushed through the outbox — see ROADMAP.md "Account
 * balance" decision). Intended to run after every sync pull; Sprint 13.6
 * wires the actual call site once the pull loop exists.
 */
export const recomputeAllLocalAccountBalances = async (db: LocalDb): Promise<Map<string, number>> => {
  const [accounts, transactions] = await Promise.all([accountsRepo.list(db), transactionsRepo.list(db)])
  const results = new Map<string, number>()

  await db.transaction(async (tx) => {
    for (const account of accounts) {
      const balance = sharedRecomputeAccountBalance(
        { type: account.type, openingBalance: account.openingBalance, currentBalance: account.currentBalance },
        toRecomputeTransactions(transactions, account._id)
      )
      results.set(account._id, balance)

      const updated: LocalAccount = { ...account, currentBalance: balance }
      await tx.exec(`UPDATE accounts SET data = ?, currentBalance = ?, _localUpdatedAt = ? WHERE _id = ?`, [
        JSON.stringify(updated),
        balance,
        new Date().toISOString(),
        account._id,
      ])
    }
  })

  return results
}
