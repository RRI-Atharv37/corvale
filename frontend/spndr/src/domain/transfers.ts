import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { generateLocalObjectId } from '../db/generateLocalId'
import { parseAmountToMinorUnits } from '@shared/money'
import { recomputeLocalAccountBalance } from './accountBalances'
import type { LocalAccount, LocalCategory, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const categoriesRepo = new Repository<LocalCategory>('categories')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

export interface CreateLocalTransferInput {
  userId: string
  workspaceId?: string | null
  title?: string
  amount: string | number
  date: string
  fromAccountId: string
  toAccountId: string
  description?: string
}

export interface CreateLocalTransferResult {
  outboundId: string
  inboundId: string
}

/**
 * Mirrors `backend/utils/transactionUtils.ts`'s `getOtherMasterCategoryId`: every transfer is filed
 * under the well-known "Other" master category (`userId: null`, `masterCategoryId: null`,
 * `name: 'Other'`, seeded by `backend/utils/categorySeed.ts`). Master categories sync down like any
 * other category, so this is a plain local lookup rather than a re-seed - if it's missing, this
 * device hasn't completed an initial sync yet.
 */
const findOtherMasterCategoryId = async (db: LocalDb): Promise<string> => {
  const categories = await categoriesRepo.list(db)
  const other = categories.find(
    (category) => category.userId === null && category.masterCategoryId === null && category.name === 'Other'
  )
  if (!other) {
    throw new Error('The "Other" category has not synced locally yet - connect and sync before creating a transfer')
  }
  return other._id
}

/**
 * Recomputes one account's balance from scratch and persists it directly (never through
 * `Repository.update`/the outbox - balance is derived, not a syncable field, per ROADMAP.md's
 * "Account balance" decision). Mirrors the single-account persistence half of
 * `domain/accountBalances.ts`'s `recomputeAllLocalAccountBalances`.
 */
const persistAccountBalance = async (db: LocalDb, accountId: string): Promise<void> => {
  const account = await accountsRepo.findById(db, accountId)
  if (!account) {
    throw new Error(`Account ${accountId} not found locally`)
  }
  const balance = await recomputeLocalAccountBalance(db, accountId)
  const updated: LocalAccount = { ...account, currentBalance: balance }
  await db.exec(`UPDATE accounts SET data = ?, currentBalance = ?, _localUpdatedAt = ? WHERE _id = ?`, [
    JSON.stringify(updated),
    balance,
    new Date().toISOString(),
    accountId,
  ])
}

/**
 * Local equivalent of `backend/services/transactionService.ts`'s `createTransferForOp`: two
 * cross-linked `LocalTransaction` rows (`transferPairId` on each, both `type: 'transfer'`), filed
 * under the shared "Other" category, same-currency requirement between the two accounts. Both
 * accounts' balances are recomputed from scratch in the same SQLite transaction as the writes - no
 * incremental balance math locally (see ROADMAP.md's "Account balance" design decision). The
 * outbound leg is created with an earlier `createdAt` than the inbound leg so
 * `domain/accountBalances.ts`'s creation-order heuristic resolves direction correctly.
 */
export const createLocalTransfer = async (
  db: LocalDb,
  input: CreateLocalTransferInput
): Promise<CreateLocalTransferResult> => {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error('Source and destination accounts must be different')
  }
  if (isNaN(Date.parse(input.date))) {
    throw new Error('Invalid date format')
  }

  const amountMinor = parseAmountToMinorUnits(input.amount)

  const [fromAccount, toAccount, transferCategoryId] = await Promise.all([
    accountsRepo.findById(db, input.fromAccountId),
    accountsRepo.findById(db, input.toAccountId),
    findOtherMasterCategoryId(db),
  ])

  if (!fromAccount) throw new Error('Account not found')
  if (!toAccount) throw new Error('Account not found')
  if (fromAccount.isArchived || toAccount.isArchived) {
    throw new Error('Account is archived')
  }
  if (fromAccount.currency !== toAccount.currency) {
    throw new Error('Transfer accounts must use the same currency')
  }

  const outboundId = generateLocalObjectId()
  const inboundId = generateLocalObjectId()
  const isoDate = new Date(input.date).toISOString()
  const outboundCreatedAt = new Date().toISOString()
  const inboundCreatedAt = new Date(Date.parse(outboundCreatedAt) + 1).toISOString()
  const title = input.title?.trim() || 'Transfer'
  const description = input.description?.trim() || undefined

  const outbound: LocalTransaction = {
    _id: outboundId,
    updatedAt: outboundCreatedAt,
    createdAt: outboundCreatedAt,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    accountId: input.fromAccountId,
    categoryId: transferCategoryId,
    type: 'transfer',
    status: 'posted',
    amount: amountMinor,
    title,
    description,
    date: isoDate,
    clearedStatus: 'pending',
    splitTransactionId: null,
    transferPairId: inboundId,
  }

  const inbound: LocalTransaction = {
    _id: inboundId,
    updatedAt: inboundCreatedAt,
    createdAt: inboundCreatedAt,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    accountId: input.toAccountId,
    categoryId: transferCategoryId,
    type: 'transfer',
    status: 'posted',
    amount: amountMinor,
    title,
    description,
    date: isoDate,
    clearedStatus: 'pending',
    splitTransactionId: null,
    transferPairId: outboundId,
  }

  await db.transaction(async (tx) => {
    await transactionsRepo.create(tx, outbound)
    await transactionsRepo.create(tx, inbound)
    await persistAccountBalance(tx, input.fromAccountId)
    await persistAccountBalance(tx, input.toAccountId)
  })

  return { outboundId, inboundId }
}
