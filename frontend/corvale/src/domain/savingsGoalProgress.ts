import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { computeSavingsGoalProgressPure, type GoalLike, type SavingsGoalProgress } from '@shared/savingsGoals'
import type { LocalSavingsGoal, LocalSavingsGoalContribution } from './types'

const goalsRepo = new Repository<LocalSavingsGoal>('savingsGoals')
const contributionsRepo = new Repository<LocalSavingsGoalContribution>('savingsGoalContributions')

const toGoalLike = (goal: LocalSavingsGoal): GoalLike => ({
  targetAmount: goal.targetAmount,
  currentAmount: goal.currentAmount,
  targetDate: goal.targetDate ? new Date(goal.targetDate) : null,
  status: goal.status,
  autoContribution: {
    enabled: goal.autoContribution.enabled,
    amount: goal.autoContribution.amount,
    interval: goal.autoContribution.interval,
  },
})

const toContributionsFor = (contributions: LocalSavingsGoalContribution[], goalId: string) =>
  contributions
    .filter((contribution) => contribution.goalId === goalId)
    .map((contribution) => ({ amount: contribution.amount, contributedAt: new Date(contribution.contributedAt) }))

export const computeLocalSavingsGoalProgress = async (
  db: LocalDb,
  goalId: string,
  now: Date = new Date()
): Promise<SavingsGoalProgress> => {
  const goal = await goalsRepo.findById(db, goalId)
  if (!goal) {
    throw new Error(`Savings goal ${goalId} not found locally`)
  }
  const allContributions = await contributionsRepo.list(db)
  return computeSavingsGoalProgressPure(toGoalLike(goal), toContributionsFor(allContributions, goal._id), now)
}

export const listLocalSavingsGoalsWithProgress = async (
  db: LocalDb,
  now: Date = new Date()
): Promise<Array<LocalSavingsGoal & { progress: SavingsGoalProgress }>> => {
  const [goals, allContributions] = await Promise.all([goalsRepo.list(db), contributionsRepo.list(db)])

  return goals.map((goal) => ({
    ...goal,
    progress: computeSavingsGoalProgressPure(toGoalLike(goal), toContributionsFor(allContributions, goal._id), now),
  }))
}
