/**
 * Sprint 13.6: durable outbox for offline mutation capture.
 *
 * Ops are grouped per `entity` (a `${entityType}:${recordId}` composite key)
 * and flushed in strict FIFO order. Within one `flush()` call we build a
 * single batch and make exactly one call to `pushFn` - not a retry loop -
 * because the real `/sync/push` applies a batch as an ordered sequence
 * server-side; looping locally would just re-derive the same ordering the
 * server already guarantees.
 *
 * Batching rule per entity: everything is included except a second (or
 * later) `update` op. A `create` has no server-side precondition to race,
 * and a `delete` never checks `baseUpdatedAt` (delete-always-wins, mirroring
 * `syncController.applyUpdateOp`/`applyOp`), so both can safely ride along
 * with an update in the same batch. Two `update`s cannot: the second one's
 * `baseUpdatedAt` was captured against pre-batch server state, which the
 * first update (applied moments earlier, same batch) has already moved past
 * - sending both would manufacture a spurious conflict. So only the first
 * `update` per entity goes out; once anything for an entity is skipped, the
 * rest of that entity's ops are held back too, to keep its own order intact.
 */

export type OutboxOperation = 'create' | 'update' | 'delete'

export interface EnqueueInput {
    entity: string
    operation: OutboxOperation
    payload: Record<string, unknown>
    baseUpdatedAt?: string
}

export interface OutboxOp extends EnqueueInput {
    opId: string
    attempts: number
    lastError: string | null
    enqueuedAt: string
    nextAttemptAt: number | null
}

/**
 * `id_conflict` (SEC-13, BUG-02): the server rejected a create whose
 * client-generated id collided with a document owned by someone else. There
 * is no server doc to reconcile against (unlike `conflict`, this was never
 * the same logical record), so it isn't routed through the conflict inbox -
 * it falls through `Outbox.flush`'s default retry-with-backoff path like
 * `rejected`, keeping the op visibly pending rather than silently dropped,
 * until the local-id-regeneration flow (not yet built) resolves it.
 */
export type PushOpStatus = 'applied' | 'conflict' | 'rejected' | 'id_conflict'

export interface PushResult {
    opId: string
    status: PushOpStatus
}

export interface Outbox {
    enqueue(input: EnqueueInput): Promise<OutboxOp>
    flush(pushFn: (ops: OutboxOp[]) => Promise<PushResult[]>): Promise<void>
    listPending(): Promise<OutboxOp[]>
    markFailed(opId: string, error: string): Promise<void>
}

/** Pluggable persistence so the real app can back this with the local SQLite `_outbox` table. */
export interface OutboxStore {
    insert(op: OutboxOp): Promise<void>
    list(): Promise<OutboxOp[]>
    update(opId: string, patch: Partial<OutboxOp>): Promise<void>
    remove(opId: string): Promise<void>
}

const BASE_BACKOFF_MS = 1000

const computeBackoffDelay = (attempts: number): number => BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1)

export const createMemoryOutboxStore = (): OutboxStore => {
    const ops = new Map<string, OutboxOp>()
    let sequence = 0
    const order = new Map<string, number>()

    return {
        async insert(op) {
            ops.set(op.opId, { ...op })
            order.set(op.opId, sequence++)
        },
        async list() {
            return [...ops.values()].sort((a, b) => (order.get(a.opId) ?? 0) - (order.get(b.opId) ?? 0))
        },
        async update(opId, patch) {
            const existing = ops.get(opId)
            if (existing) {
                ops.set(opId, { ...existing, ...patch })
            }
        },
        async remove(opId) {
            ops.delete(opId)
            order.delete(opId)
        },
    }
}

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine

const isWorkspaceScoped = (payload: Record<string, unknown>): boolean =>
    typeof payload.workspaceId === 'string' && payload.workspaceId.length > 0

/** Selects the batch to send this flush: FIFO per entity, at most one `update` per entity (see module doc). */
const buildBatch = (pending: OutboxOp[], now: number): OutboxOp[] => {
    const batch: OutboxOp[] = []
    const blockedEntities = new Set<string>()
    const updateSentForEntity = new Set<string>()

    for (const op of pending) {
        if (blockedEntities.has(op.entity)) {
            continue
        }
        if (op.nextAttemptAt !== null && op.nextAttemptAt > now) {
            blockedEntities.add(op.entity)
            continue
        }
        if (op.operation === 'update' && updateSentForEntity.has(op.entity)) {
            blockedEntities.add(op.entity)
            continue
        }
        if (op.operation === 'update') {
            updateSentForEntity.add(op.entity)
        }
        batch.push(op)
    }

    return batch
}

export interface OutboxOptions {
    /** Fired after a successful enqueue - Sprint 13.8 uses this to register Background Sync so a
     * closed/backgrounded tab still has a chance to flush (see `pwa/backgroundSync.ts`). Kept as an
     * injected callback rather than an import here so this module stays environment-agnostic and
     * testable outside a browser (see the design notes atop `sync/__tests__/outbox.test.ts`). */
    onEnqueued?: () => void
}

export const createOutbox = (store: OutboxStore = createMemoryOutboxStore(), options: OutboxOptions = {}): Outbox => {
    const enqueue = async (input: EnqueueInput): Promise<OutboxOp> => {
        if (!isOnline() && isWorkspaceScoped(input.payload)) {
            throw new Error('Workspace-scoped writes require connectivity - you are offline')
        }

        const op: OutboxOp = {
            ...input,
            opId: crypto.randomUUID(),
            attempts: 0,
            lastError: null,
            enqueuedAt: new Date().toISOString(),
            nextAttemptAt: null,
        }
        await store.insert(op)
        options.onEnqueued?.()
        return op
    }

    const listPending = (): Promise<OutboxOp[]> => store.list()

    const markFailed = async (opId: string, error: string): Promise<void> => {
        const [op] = (await store.list()).filter((pending) => pending.opId === opId)
        if (!op) {
            return
        }
        const attempts = op.attempts + 1
        await store.update(opId, {
            attempts,
            lastError: error,
            nextAttemptAt: Date.now() + computeBackoffDelay(attempts),
        })
    }

    const flush = async (pushFn: (ops: OutboxOp[]) => Promise<PushResult[]>): Promise<void> => {
        if (!isOnline()) {
            return
        }

        const pending = await store.list()
        const batch = buildBatch(pending, Date.now())
        if (batch.length === 0) {
            return
        }

        const results = await pushFn(batch)

        for (const result of results) {
            if (result.status === 'applied' || result.status === 'conflict') {
                await store.remove(result.opId)
                continue
            }

            const op = batch.find((candidate) => candidate.opId === result.opId)
            const attempts = (op?.attempts ?? 0) + 1
            await store.update(result.opId, {
                attempts,
                nextAttemptAt: Date.now() + computeBackoffDelay(attempts),
            })
        }
    }

    return { enqueue, flush, listPending, markFailed }
}
