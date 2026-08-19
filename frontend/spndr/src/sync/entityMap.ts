import type { SyncableTableName } from '../db/repositories/Repository'

/**
 * Mirrors `backend/services/syncService.ts` `SYNC_ENTITIES` / `RESPONSE_FIELD`:
 * the singular entity name used on the wire (outbox ops, pull changes/tombstones,
 * `SyncOperation.entity`) against the plural local table name it's stored in.
 */
export const ENTITY_TO_TABLE = {
    account: 'accounts',
    transaction: 'transactions',
    category: 'categories',
    budget: 'budgets',
    savingsGoal: 'savingsGoals',
    tag: 'tags',
    recurringRule: 'recurringRules',
    categorizationRule: 'categorizationRules',
    savingsGoalContribution: 'savingsGoalContributions',
} as const satisfies Record<string, SyncableTableName>

export type SyncEntityName = keyof typeof ENTITY_TO_TABLE

export const TABLE_TO_ENTITY = Object.fromEntries(
    Object.entries(ENTITY_TO_TABLE).map(([entity, table]) => [table, entity])
) as Record<SyncableTableName, SyncEntityName>

/** Splits an outbox `entity` field (`'transaction:txn1'`) into its parts. */
export const parseOutboxEntity = (entity: string): { entityType: string; recordId: string } => {
    const separatorIndex = entity.indexOf(':')
    if (separatorIndex === -1) {
        return { entityType: entity, recordId: '' }
    }
    return { entityType: entity.slice(0, separatorIndex), recordId: entity.slice(separatorIndex + 1) }
}

export const buildOutboxEntity = (entityType: SyncEntityName, recordId: string): string => `${entityType}:${recordId}`
