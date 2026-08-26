import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { parseAmountToMinorUnits } from '@shared/money'
import { resolveDateRange } from '@shared/timezone'
import type { LocalCategory, LocalTransaction } from './types'

const transactionsRepo = new Repository<LocalTransaction>('transactions')
const categoriesRepo = new Repository<LocalCategory>('categories')

export interface TransactionListFilters {
  type?: 'income' | 'expense' | 'transfer'
  clearedStatus?: 'cleared' | 'pending'
  accountId?: string
  tags?: string[]
}

export type TransactionSortBy = 'date' | 'amount' | 'category'
export type TransactionSortOrder = 'asc' | 'desc'

/** Mirrors `LISTABLE_TRANSACTION_FILTER` + `buildListFilter` on the server: split children never appear in list/filter/search results. */
const applyListFilters = (transactions: LocalTransaction[], filters: TransactionListFilters): LocalTransaction[] =>
  transactions
    .filter((tx) => tx.splitTransactionId === null)
    .filter((tx) => (filters.type ? tx.type === filters.type : true))
    .filter((tx) => (filters.clearedStatus ? tx.clearedStatus === filters.clearedStatus : true))
    .filter((tx) => (filters.accountId ? tx.accountId === filters.accountId : true))
    .filter((tx) =>
      filters.tags && filters.tags.length > 0 ? filters.tags.some((tag) => (tx.tags ?? []).includes(tag)) : true
    )

const sortTransactions = (
  transactions: LocalTransaction[],
  sortBy: TransactionSortBy | undefined,
  sortOrder: TransactionSortOrder | undefined,
  categoryNameById: Map<string, string>
): LocalTransaction[] => {
  const direction = sortOrder === 'asc' ? 1 : -1
  const sorted = [...transactions]

  if (sortBy === 'amount') {
    sorted.sort((a, b) => (a.amount - b.amount) * direction)
  } else if (sortBy === 'category') {
    sorted.sort((a, b) => {
      const nameA = categoryNameById.get(a.categoryId) ?? ''
      const nameB = categoryNameById.get(b.categoryId) ?? ''
      const cmp = nameA.localeCompare(nameB)
      return cmp !== 0 ? cmp * direction : b.date.localeCompare(a.date)
    })
  } else {
    sorted.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * direction)
  }

  return sorted
}

const loadCategoryNames = async (db: LocalDb): Promise<Map<string, string>> => {
  const categories = await categoriesRepo.list(db)
  return new Map(categories.map((category) => [category._id, category.name]))
}

/** Local counterpart to `GET /transactions`. */
export const listLocalTransactions = async (
  db: LocalDb,
  filters: TransactionListFilters = {},
  sortBy?: TransactionSortBy,
  sortOrder?: TransactionSortOrder
): Promise<LocalTransaction[]> => {
  const [transactions, categoryNameById] = await Promise.all([transactionsRepo.list(db), loadCategoryNames(db)])
  return sortTransactions(applyListFilters(transactions, filters), sortBy, sortOrder, categoryNameById)
}

/** Local counterpart to `GET /transactions/filter`. */
export const filterLocalTransactions = async (
  db: LocalDb,
  startDate: string,
  endDate: string,
  timezone: string,
  filters: TransactionListFilters = {},
  sortBy?: TransactionSortBy,
  sortOrder?: TransactionSortOrder
): Promise<LocalTransaction[]> => {
  const { start, end } = resolveDateRange(startDate, endDate, timezone)
  const [transactions, categoryNameById] = await Promise.all([transactionsRepo.list(db), loadCategoryNames(db)])

  const inRange = applyListFilters(transactions, filters).filter((tx) => {
    const date = new Date(tx.date)
    return date >= start && date <= end
  })

  return sortTransactions(inRange, sortBy, sortOrder, categoryNameById)
}

const matchesKeyword = (transaction: LocalTransaction, needle: string, numericKeyword: number | null): boolean => {
  const haystacks = [transaction.title, transaction.description, transaction.source, transaction.paymentMethod, ...(transaction.tags ?? [])]
  if (haystacks.some((value) => value?.toLowerCase().includes(needle))) {
    return true
  }
  return numericKeyword !== null && transaction.amount === numericKeyword
}

/** Local counterpart to `GET /transactions/search`. */
export const searchLocalTransactions = async (
  db: LocalDb,
  keyword: string,
  filters: TransactionListFilters = {},
  sortBy?: TransactionSortBy,
  sortOrder?: TransactionSortOrder
): Promise<LocalTransaction[]> => {
  const needle = keyword.trim().slice(0, 100).toLowerCase()
  let numericKeyword: number | null = null
  if (!isNaN(Number(keyword))) {
    try {
      numericKeyword = parseAmountToMinorUnits(keyword)
    } catch {
      numericKeyword = null
    }
  }

  const [transactions, categoryNameById] = await Promise.all([transactionsRepo.list(db), loadCategoryNames(db)])
  const matched = applyListFilters(transactions, filters).filter((tx) => matchesKeyword(tx, needle, numericKeyword))
  return sortTransactions(matched, sortBy, sortOrder, categoryNameById)
}
