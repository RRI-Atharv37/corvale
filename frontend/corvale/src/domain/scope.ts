export interface LocalScope {
  workspaceId?: string | null
}

type Scoped = { workspaceId?: string | null }

export const isInScope = (record: Scoped, workspaceId: string | null | undefined): boolean =>
  workspaceId ? record.workspaceId === workspaceId : !record.workspaceId

export const scopedTo = <T extends Scoped>(records: T[], scope: LocalScope = {}): T[] =>
  records.filter((record) => isInScope(record, scope.workspaceId))
