import { Repository, type SyncableTableName } from '../db/repositories/Repository'
import { ENTITY_TO_TABLE, type SyncEntityName } from './entityMap'

const REPOSITORIES: Record<SyncEntityName, Repository<never>> = Object.fromEntries(
    (Object.keys(ENTITY_TO_TABLE) as SyncEntityName[]).map((entity) => [
        entity,
        new Repository(ENTITY_TO_TABLE[entity] as SyncableTableName),
    ])
) as Record<SyncEntityName, Repository<never>>

export const getSyncRepository = (entity: string): Repository<never> | undefined =>
    REPOSITORIES[entity as SyncEntityName]
