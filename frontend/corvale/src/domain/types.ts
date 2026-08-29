import type { AccountType, TransactionStatus, TransactionType } from '@shared/types'
import type { SyncableRecord } from '../db/repositories/Repository'

/**
 * Local-store record shapes: what `JSON.parse(row.data)` yields for each
 * syncable table. Server documents are stored verbatim as JSON (see
 * `db/repositories/Repository.ts`), so dates arrive as ISO strings, not
 * `Date` objects — every domain module that calls into `shared/` (which
 * expects `Date`) must convert first. Each extends `SyncableRecord` (rather
 * than redeclaring `_id`/`updatedAt`/`deletedAt`) so `Repository<T>`'s
 * `T extends SyncableRecord` constraint is satisfied structurally.
 */

export interface LocalAccount extends SyncableRecord {
  userId: string
  workspaceId?: string | null
  name: string
  type: AccountType
  currency: string
  currentBalance: number
  openingBalance?: number
  /** ISO string; transactions dated before this don't move currentBalance. Absent = legacy (all count). */
  openingBalanceDate?: string | null
  isArchived: boolean
}

export interface LocalTransaction extends SyncableRecord {
  userId: string
  workspaceId?: string | null
  accountId: string
  categoryId: string
  type: TransactionType
  status: TransactionStatus
  amount: number
  title: string
  description?: string
  date: string
  clearedStatus?: 'cleared' | 'pending'
  tags?: string[]
  paymentMethod?: string
  source?: string
  splitTransactionId: string | null
  /** Set on both legs of a transfer (mirrors `backend/models/Transaction.ts`); null otherwise. */
  transferPairId?: string | null
  /**
   * Mongoose `timestamps: true` creation time - present on every server
   * document (hence in the `data` JSON blob) even though it isn't a
   * `PROMOTED_COLUMNS` entry. Needed to tell a transfer's outbound leg from
   * its inbound leg (see `domain/accountBalances.ts`) the same way
   * `backend/controllers/accountController.ts`'s `recomputeBalance` does.
   */
  createdAt?: string
}

export interface LocalCategory extends SyncableRecord {
  userId: string | null
  masterCategoryId: string | null
  name: string
  color?: string
  isArchived: boolean
}

export interface LocalBudget extends SyncableRecord {
  userId: string
  workspaceId?: string | null
  name?: string
  categoryId: string | null
  periodStart: string
  periodEnd: string
  amount: number
  accountIds: string[]
  isArchived: boolean
}

export interface LocalSavingsGoal extends SyncableRecord {
  userId: string
  workspaceId?: string | null
  name: string
  targetAmount: number
  currentAmount: number
  targetDate: string | null
  status: 'active' | 'paused' | 'completed' | 'archived'
  autoContribution: {
    enabled: boolean
    amount: number
    interval: 'weekly' | 'monthly'
    dayOfMonth?: number
    lastContributedAt?: string
  }
}

export interface LocalSavingsGoalContribution extends SyncableRecord {
  userId: string
  goalId: string
  amount: number
  contributedAt: string
}

export interface LocalCategorizationRule extends SyncableRecord {
  userId: string
  name: string
  matchType: 'description_contains' | 'description_equals' | 'amount_range' | 'account_id'
  matchValue?: string
  amountMin?: number
  amountMax?: number
  accountId?: string
  categoryId: string
  tags?: string[]
  priority: number
  isActive: boolean
}

export interface LocalTag extends SyncableRecord {
  userId: string
  name: string
  color?: string
}

export interface LocalRecurringRule extends SyncableRecord {
  userId: string
  workspaceId?: string | null
  title: string
  type: Exclude<TransactionType, 'transfer'>
  amount: number
  currency: string
  accountId: string
  categoryId: string
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
  customIntervalDays?: number
  nextDueDate: string
  description?: string
  paymentMethod?: string
  tags?: string[]
  isActive: boolean
  isArchived: boolean
  isCancelled: boolean
}

export interface LocalTransactionTemplate extends SyncableRecord {
  userId: string
  name: string
  type: Exclude<TransactionType, 'transfer'>
  amount: number
  accountId: string
  categoryId: string
  tags?: string[]
  description?: string
}
