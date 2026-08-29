import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { recomputeAccountBalance as sharedRecomputeAccountBalance } from '@shared/balances'
import type { LocalAccount, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

/**
 * Both legs of a transfer persist with `type: 'transfer'` (mirrors
 * `backend/controllers/accountController.ts`'s `recomputeBalance` comment) -
 * direction is only recoverable via creation order relative to the paired
 * leg. The outbound leg keeps the 'transfer' delta formula (a withdrawal);
 * the inbound leg is fed as 'income' to reuse the income delta formula. This
 * needs every local transaction (not just the target account's) since a
 * leg's pair lives in a different account.
 */
const buildPairCreatedAtById = (transactions: LocalTransaction[]): Map<string, string> => {
  const byId = new Map(transactions.map((tx) => [tx._id, tx.createdAt ?? tx.updatedAt]))
  const pairCreatedAtById = new Map<string, string>()
  for (const tx of transactions) {
    if (tx.type === 'transfer' && tx.transferPairId) {
      const pairCreatedAt = byId.get(tx.transferPairId)
      if (pairCreatedAt) pairCreatedAtById.set(tx._id, pairCreatedAt)
    }
  }
  return pairCreatedAtById
}

const toRecomputeTransactions = (
  transactions: LocalTransaction[],
  accountId: string,
  pairCreatedAtById: Map<string, string>
) =>
  transactions
    .filter((tx) => tx.accountId === accountId)
    .map((tx) => {
      let effectiveType = tx.type
      if (tx.type === 'transfer' && tx.transferPairId) {
        const pairCreatedAt = pairCreatedAtById.get(tx._id)
        const ownCreatedAt = tx.createdAt ?? tx.updatedAt
        const isInbound = pairCreatedAt !== undefined && ownCreatedAt > pairCreatedAt
        effectiveType = isInbound ? 'income' : 'transfer'
      }
      return {
        type: effectiveType,
        amount: tx.amount,
        status: tx.status,
        splitTransactionId: tx.splitTransactionId,
        date: tx.date,
      }
    })

/** Recomputes one account's balance from its opening balance plus every posted, non-split-child local transaction. */
export const recomputeLocalAccountBalance = async (db: LocalDb, accountId: string): Promise<number> => {
  const account = await accountsRepo.findById(db, accountId)
  if (!account) {
    throw new Error(`Account ${accountId} not found locally`)
  }
  const transactions = await transactionsRepo.list(db)
  const pairCreatedAtById = buildPairCreatedAtById(transactions)
  return sharedRecomputeAccountBalance(
    {
      type: account.type,
      openingBalance: account.openingBalance,
      currentBalance: account.currentBalance,
      openingBalanceDate: account.openingBalanceDate ?? null,
    },
    toRecomputeTransactions(transactions, account._id, pairCreatedAtById)
  )
}

/**
 * Recomputes every local account's balance in one pass and persists the
 * result back into `accounts.currentBalance` (promoted column + `data`
 * blob), without touching `updatedAt` (server-authoritative, used for sync
 * ordering) or the dirty/sync-state columns (balance is a derived value,
 * never itself pushed through the outbox — see the "Account balance"
 * architecture decision).
 */
export const recomputeAllLocalAccountBalances = async (db: LocalDb): Promise<Map<string, number>> => {
  const [accounts, transactions] = await Promise.all([accountsRepo.list(db), transactionsRepo.list(db)])
  const pairCreatedAtById = buildPairCreatedAtById(transactions)
  const results = new Map<string, number>()

  await db.transaction(async (tx) => {
    for (const account of accounts) {
      const balance = sharedRecomputeAccountBalance(
        {
          type: account.type,
          openingBalance: account.openingBalance,
          currentBalance: account.currentBalance,
          openingBalanceDate: account.openingBalanceDate ?? null,
        },
        toRecomputeTransactions(transactions, account._id, pairCreatedAtById)
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
