import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { recomputeAccountBalance as sharedRecomputeAccountBalance } from '@shared/balances'
import { isInboundTransferLeg, type TransferRole } from '@shared/transferDirection'
import type { LocalAccount, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

export interface TransferPairStamp {
  createdAt: string
  transferRole?: TransferRole | null
}

/**
 * Both legs of a transfer persist with `type: 'transfer'`; each leg's stored `transferRole` says
 * which side it is. A leg without one (synced down before the backend backfill) is resolved against
 * its pair by creation order instead. The outbound leg keeps the 'transfer' delta formula (a
 * withdrawal); the inbound leg is fed as 'income' to reuse the income delta formula. This needs
 * every local transaction (not just the target account's) since a leg's pair lives in a different
 * account.
 */
export const buildTransferPairStamps = (transactions: LocalTransaction[]): Map<string, TransferPairStamp> => {
  const byId = new Map(transactions.map((tx) => [tx._id, tx]))
  const stamps = new Map<string, TransferPairStamp>()
  for (const tx of transactions) {
    if (tx.type === 'transfer' && tx.transferPairId) {
      const pair = byId.get(tx.transferPairId)
      const pairCreatedAt = pair && (pair.createdAt ?? pair.updatedAt)
      if (pair && pairCreatedAt) stamps.set(tx._id, { createdAt: pairCreatedAt, transferRole: pair.transferRole })
    }
  }
  return stamps
}

/** Direction a transfer leg represents. `undefined` when the leg has no stored role and its pair isn't
 * in `pairStamps` (e.g. filtered out of the current query) - callers should fall back to a neutral,
 * non-directional display for that case, mirroring the backend's `attachTransferDirections`
 * (`backend/src/modules/transactions/transactionUtils.ts`). */
export const getTransferDirection = (
  tx: Pick<LocalTransaction, '_id' | 'type' | 'transferPairId' | 'transferRole' | 'createdAt' | 'updatedAt'>,
  pairStamps: Map<string, TransferPairStamp>
): 'out' | 'in' | undefined => {
  if (tx.type !== 'transfer' || !tx.transferPairId) return undefined
  const pair = pairStamps.get(tx._id)
  if (!tx.transferRole && pair === undefined) return undefined
  const ownCreatedAt = tx.createdAt ?? tx.updatedAt
  return isInboundTransferLeg(
    { id: tx._id, createdAt: ownCreatedAt, transferRole: tx.transferRole },
    { id: tx.transferPairId, createdAt: pair?.createdAt ?? ownCreatedAt, transferRole: pair?.transferRole }
  )
    ? 'in'
    : 'out'
}

const toRecomputeTransactions = (
  transactions: LocalTransaction[],
  accountId: string,
  pairStamps: Map<string, TransferPairStamp>
) =>
  transactions
    .filter((tx) => tx.accountId === accountId)
    .map((tx) => {
      let effectiveType = tx.type
      if (tx.type === 'transfer' && tx.transferPairId) {
        effectiveType = getTransferDirection(tx, pairStamps) === 'in' ? 'income' : 'transfer'
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
  const pairStamps = buildTransferPairStamps(transactions)
  return sharedRecomputeAccountBalance(
    {
      type: account.type,
      openingBalance: account.openingBalance,
      currentBalance: account.currentBalance,
      openingBalanceDate: account.openingBalanceDate ?? null,
    },
    toRecomputeTransactions(transactions, account._id, pairStamps)
  )
}

/** Recomputes one account's balance and writes it straight to the row, bypassing the outbox (balance is derived, never pushed). */
export const persistLocalAccountBalance = async (db: LocalDb, accountId: string): Promise<number> => {
  const account = await accountsRepo.findById(db, accountId)
  if (!account) {
    throw new Error(`Account ${accountId} not found locally`)
  }
  const balance = await recomputeLocalAccountBalance(db, accountId)
  await accountsRepo.patchLocal(db, accountId, { currentBalance: balance })
  return balance
}

/**
 * Recomputes every local account's balance in one pass and persists the
 * result back into `accounts.currentBalance` (promoted column + `data`
 * blob), without touching `updatedAt` (server-authoritative, used for sync
 * ordering) or the dirty/sync-state columns (balance is a derived value,
 * never itself pushed through the outbox - see the "Account balance"
 * architecture decision).
 */
export const recomputeAllLocalAccountBalances = async (db: LocalDb): Promise<Map<string, number>> => {
  const [accounts, transactions] = await Promise.all([accountsRepo.list(db), transactionsRepo.list(db)])
  const pairStamps = buildTransferPairStamps(transactions)
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
        toRecomputeTransactions(transactions, account._id, pairStamps)
      )
      results.set(account._id, balance)

      await accountsRepo.patchLocal(tx, account._id, { currentBalance: balance })
    }
  })

  return results
}
