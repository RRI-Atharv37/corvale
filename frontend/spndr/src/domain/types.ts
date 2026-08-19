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
