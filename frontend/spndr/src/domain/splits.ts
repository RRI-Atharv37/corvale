import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { generateLocalObjectId } from '../db/generateLocalId'
import { parseAmountToMinorUnits, validateSplitInputs, type SplitInput } from '@shared/money'
import { recomputeLocalAccountBalance } from './accountBalances'
import type { LocalAccount, LocalTransaction } from './types'

const accountsRepo = new Repository<LocalAccount>('accounts')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

export interface CreateLocalSplitInput {
  userId: string
  workspaceId?: string | null
  title: string
  amount: string | number
  date: string
  accountId: string
  description?: string
  paymentMethod?: string
  tags?: string[]
  splits: SplitInput[]
}

export interface CreateLocalSplitResult {
  parentId: string
  childIds: string[]
}

/** See `domain/transfers.ts`'s identical helper for why this writes `accounts` directly rather than through `Repository.update`. */
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
 * Local equivalent of `backend/services/transactionService.ts`'s `createTransactionForUser` +
 * `createSplitChildren` when `splits` is present: one parent `LocalTransaction` row (`type:
 * 'expense'`, `splitTransactionId: null`, `categoryId` taken from the first split line - mirrors
 * the server's `resolvedCategoryId = hasSplits ? splits[0].categoryId : categoryId`) plus one child
 * row per split line (`splitTransactionId: <parentId>`, own `categoryId`/`amount`). Categorization
 * rules are never applied to split creates, matching the server (`applyCategorizationRules` is only
 * called in the `!hasSplits` branch there).
 *
 * `shared/src/balances.ts`'s `recomputeAccountBalance` filters transactions to
 * `splitTransactionId == null`, so the parent (which carries the full amount and a null
 * `splitTransactionId`) is counted once and the children are excluded - a single recompute after
 * inserting parent + children is correct. See `domain/__tests__/localDomainParity.test.ts`'s "counts
 * a split parent once and ignores its split children" case for the server-matching fixture this
 * mirrors.
 */
export const createLocalSplitExpense = async (
  db: LocalDb,
  input: CreateLocalSplitInput
): Promise<CreateLocalSplitResult> => {
  const amountMinor = parseAmountToMinorUnits(input.amount)
  const normalizedSplits = validateSplitInputs(input.splits, amountMinor)
  if (isNaN(Date.parse(input.date))) {
    throw new Error('Invalid date format')
  }

  const account = await accountsRepo.findById(db, input.accountId)
  if (!account) {
    throw new Error('Account not found')
  }
  if (account.isArchived) {
    throw new Error('Account is archived')
  }

  const parentId = generateLocalObjectId()
  const baseNow = Date.now()
  const isoDate = new Date(input.date).toISOString()
  const title = input.title.trim()
  const description = input.description?.trim() || undefined
  const paymentMethod = input.paymentMethod?.trim() || undefined
  const tags = input.tags && input.tags.length > 0 ? input.tags : undefined

  const parent: LocalTransaction = {
    _id: parentId,
    updatedAt: new Date(baseNow).toISOString(),
    createdAt: new Date(baseNow).toISOString(),
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    accountId: input.accountId,
    categoryId: normalizedSplits[0].categoryId,
    type: 'expense',
    status: 'posted',
    amount: amountMinor,
    title,
    description,
    date: isoDate,
    clearedStatus: 'pending',
    tags,
    paymentMethod,
    splitTransactionId: null,
  }

  const children: LocalTransaction[] = normalizedSplits.map((split, index) => {
    const createdAt = new Date(baseNow + index + 1).toISOString()
    return {
      _id: generateLocalObjectId(),
      updatedAt: createdAt,
      createdAt,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      accountId: input.accountId,
      categoryId: split.categoryId,
      type: 'expense',
      status: 'posted',
      amount: split.amount,
      title,
      description,
      date: isoDate,
      clearedStatus: 'pending',
      tags,
      paymentMethod,
      splitTransactionId: parentId,
    }
  })

  await db.transaction(async (tx) => {
    await transactionsRepo.create(tx, parent)
    for (const child of children) {
      await transactionsRepo.create(tx, child)
    }
    await persistAccountBalance(tx, input.accountId)
  })

  return { parentId, childIds: children.map((child) => child._id) }
}
