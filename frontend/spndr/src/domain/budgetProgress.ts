import type { LocalDb } from '../db/LocalDb'
import { Repository } from '../db/repositories/Repository'
import { computeBudgetProgress, computeBudgetSpentMinorPure, type BudgetProgress } from '@shared/budget'
import type { LocalBudget, LocalTransaction } from './types'

const budgetsRepo = new Repository<LocalBudget>('budgets')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

const toBudgetTransactionLike = (tx: LocalTransaction) => ({
  _id: tx._id,
  accountId: tx.accountId,
  categoryId: tx.categoryId,
  type: tx.type,
  status: tx.status,
  amount: tx.amount,
  date: new Date(tx.date),
  splitTransactionId: tx.splitTransactionId,
})

const budgetSpentMinor = (budget: LocalBudget, transactions: LocalTransaction[]): number =>
  computeBudgetSpentMinorPure(
    {
      categoryId: budget.categoryId,
      periodStart: new Date(budget.periodStart),
      periodEnd: new Date(budget.periodEnd),
      accountIds: budget.accountIds ?? [],
    },
    transactions.map(toBudgetTransactionLike)
  )

export const computeLocalBudgetProgress = async (db: LocalDb, budgetId: string): Promise<BudgetProgress> => {
  const budget = await budgetsRepo.findById(db, budgetId)
  if (!budget) {
    throw new Error(`Budget ${budgetId} not found locally`)
  }
  const transactions = await transactionsRepo.list(db)
  return computeBudgetProgress(budget.amount, budgetSpentMinor(budget, transactions))
}

export const listLocalBudgetsWithProgress = async (
  db: LocalDb
): Promise<Array<LocalBudget & { progress: BudgetProgress }>> => {
  const [budgets, transactions] = await Promise.all([budgetsRepo.list(db), transactionsRepo.list(db)])

  return budgets.map((budget) => ({
    ...budget,
    progress: computeBudgetProgress(budget.amount, budgetSpentMinor(budget, transactions)),
  }))
}
