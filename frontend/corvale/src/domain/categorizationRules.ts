import type { LocalDb } from '@platform/db/LocalDb'
import { Repository } from '@platform/db/repositories/Repository'
import { matchCategorizationRule, type TransactionMatchInput } from '@shared/categorization'
import type { LocalCategorizationRule, LocalTransaction } from './types'

export type { TransactionMatchInput }

const rulesRepo = new Repository<LocalCategorizationRule>('categorizationRules')
const transactionsRepo = new Repository<LocalTransaction>('transactions')

export interface RuleApplyResult {
  categoryId: string
  tags: string[]
  ruleId: string
  ruleName: string
}

const sortByPriorityDesc = (rules: LocalCategorizationRule[]): LocalCategorizationRule[] =>
  [...rules].sort((a, b) => b.priority - a.priority)

const toRuleLike = (rule: LocalCategorizationRule) => ({
  isActive: rule.isActive,
  matchType: rule.matchType,
  matchValue: rule.matchValue,
  amountMin: rule.amountMin,
  amountMax: rule.amountMax,
  accountId: rule.accountId,
})

/** Also usable as the rule tester (dry-run: does this rule match this input, without applying anything). */
export const ruleMatchesTransactionLocal = (rule: LocalCategorizationRule, input: TransactionMatchInput): boolean =>
  matchCategorizationRule(toRuleLike(rule), input)

/** First-match-wins against active rules ordered by priority desc, mirroring the server's findMatchingRule. */
export const findMatchingLocalRule = async (
  db: LocalDb,
  input: TransactionMatchInput
): Promise<LocalCategorizationRule | null> => {
  const rules = sortByPriorityDesc((await rulesRepo.list(db)).filter((rule) => rule.isActive))
  return rules.find((rule) => ruleMatchesTransactionLocal(rule, input)) ?? null
}

/** Used on transaction create: returns the category/tags to apply, or null if no active rule matches. */
export const applyLocalCategorizationRules = async (
  db: LocalDb,
  input: TransactionMatchInput
): Promise<RuleApplyResult | null> => {
  const rule = await findMatchingLocalRule(db, input)
  if (!rule) {
    return null
  }
  return { categoryId: rule.categoryId, tags: rule.tags ?? [], ruleId: rule._id, ruleName: rule.name }
}

const mergeTags = (existing: string[] | undefined, ruleTags: string[] | undefined): string[] | undefined => {
  if (!ruleTags || ruleTags.length === 0) {
    return existing
  }
  const merged = [...new Set([...(existing ?? []), ...ruleTags])]
  return merged.length > 0 ? merged : undefined
}

/**
 * Mirrors the server's bulkApplyCategorizationRules: re-evaluates every
 * non-transfer, non-split-child transaction against the active rule set and
 * updates the ones that changed. Marks touched rows `_dirty` so Sprint
 * 13.6's outbox flush can pick them up once it exists; it does not itself
 * enqueue an outbox op.
 */
export const bulkApplyLocalCategorizationRules = async (
  db: LocalDb
): Promise<{ updated: number; skipped: number }> => {
  const rules = sortByPriorityDesc((await rulesRepo.list(db)).filter((rule) => rule.isActive))
  if (rules.length === 0) {
    return { updated: 0, skipped: 0 }
  }

  const transactions = (await transactionsRepo.list(db)).filter(
    (tx) => tx.type !== 'transfer' && tx.splitTransactionId === null
  )

  let updated = 0
  let skipped = 0

  await db.transaction(async (tx) => {
    for (const transaction of transactions) {
      const matchInput: TransactionMatchInput = {
        title: transaction.title,
        description: transaction.description,
        amount: transaction.amount,
        accountId: transaction.accountId,
        type: transaction.type,
      }

      const matchedRule = rules.find((rule) => ruleMatchesTransactionLocal(rule, matchInput))
      if (!matchedRule) {
        skipped += 1
        continue
      }

      const nextTags = mergeTags(transaction.tags, matchedRule.tags)
      const categoryChanged = transaction.categoryId !== matchedRule.categoryId
      const tagsChanged = JSON.stringify(transaction.tags ?? []) !== JSON.stringify(nextTags ?? [])

      if (!categoryChanged && !tagsChanged) {
        skipped += 1
        continue
      }

      const updatedTransaction: LocalTransaction = { ...transaction, categoryId: matchedRule.categoryId, tags: nextTags }
      await tx.exec(
        `UPDATE transactions SET data = ?, categoryId = ?, _localUpdatedAt = ?, _dirty = 1 WHERE _id = ?`,
        [JSON.stringify(updatedTransaction), matchedRule.categoryId, new Date().toISOString(), transaction._id]
      )
      updated += 1
    }
  })

  return { updated, skipped }
}
