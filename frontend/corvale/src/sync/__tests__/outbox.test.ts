import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createOutbox } from '../outbox'
import type { Outbox, OutboxOp } from '../outbox'

// Design decisions (module `../outbox` does not exist yet - Sprint 13.6):
// - `createOutbox()` is assumed as the factory export that returns a fresh, isolated
//   `Outbox` instance (the real implementation backs it with the local SQLite `_outbox`
//   table; tests only depend on the `Outbox` interface from the architecture doc).
// - `entity` is assumed to be a composite `${entityType}:${recordId}` string (e.g.
//   `'transaction:txn1'`) so per-record FIFO ordering can be derived by grouping on the
//   exact string. A real implementation may prefer separate `entityType`/`entityId`
//   fields - reconcile during 13.6.
// - Workspace scoping is assumed to be detected via `payload.workspaceId` (a plain
//   object field), since `OutboxOp` has no dedicated top-level `workspaceId`.
// - Backoff curve: base 1000ms, doubling per attempt (1s, 2s, 4s, ...). Only the base
//   delay is asserted here (via fake timers) since the cap is an implementation detail
//   not specified by the architecture doc.
// - A rejected push result keeps the op pending (for retry); a conflict result removes
//   it from the outbox (handed off to the future `_conflicts` inbox, out of scope here).

type PushResult = { opId: string; status: 'applied' | 'conflict' | 'rejected' }

const applyAll = async (ops: OutboxOp[]): Promise<PushResult[]> =>
    ops.map((op) => ({ opId: op.opId, status: 'applied' as const }))

const setOnline = (online: boolean): void => {
    Object.defineProperty(navigator, 'onLine', { value: online, writable: true, configurable: true })
}

describe('outbox', () => {
    let outbox: Outbox

    beforeEach(() => {
        vi.useFakeTimers()
        setOnline(true)
        outbox = createOutbox()
    })

    afterEach(() => {
        vi.useRealTimers()
        setOnline(true)
    })

    describe('enqueue + ordering', () => {
        it('flushes ops in the exact order they were enqueued, across entities', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: { name: 'Checking' } })
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: { amount: 100 } })
            await outbox.enqueue({ entity: 'account:acc2', operation: 'delete', payload: {} })

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)

            expect(pushFn).toHaveBeenCalledTimes(1)
            const sentOps = pushFn.mock.calls[0][0] as OutboxOp[]
            expect(sentOps.map((op) => op.entity)).toEqual(['account:acc1', 'transaction:txn1', 'account:acc2'])
        })

        it('removes applied ops from the pending list', async () => {
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: {} })
            await outbox.flush(vi.fn(applyAll))

            expect(await outbox.listPending()).toEqual([])
        })

        it('preserves create-then-update-then-delete order for the same record', async () => {
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: { amount: 10 } })
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'update', payload: { amount: 20 } })
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'delete', payload: {} })

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)

            const sentOps = pushFn.mock.calls[0][0] as OutboxOp[]
            expect(sentOps.map((op) => op.operation)).toEqual(['create', 'update', 'delete'])
        })

        it('does nothing when there are no pending ops', async () => {
            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)

            expect(pushFn).not.toHaveBeenCalled()
        })
    })

    describe('retry and backoff', () => {
        it('does not retry a failed op immediately on the next flush', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })

            const rejecting = vi.fn(async (ops: OutboxOp[]) =>
                ops.map((op) => ({ opId: op.opId, status: 'rejected' as const }))
            )
            await outbox.flush(rejecting)
            expect(rejecting).toHaveBeenCalledTimes(1)

            rejecting.mockClear()
            await outbox.flush(rejecting)
            expect(rejecting).not.toHaveBeenCalled()
        })

        it('retries a failed op only after its backoff window elapses', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            const [{ opId }] = await outbox.listPending()

            const failThenSucceed = vi
                .fn()
                .mockResolvedValueOnce([{ opId, status: 'rejected' as const }])
                .mockResolvedValue([{ opId, status: 'applied' as const }])

            await outbox.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(999)
            await outbox.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(1)

            vi.advanceTimersByTime(2)
            await outbox.flush(failThenSucceed)
            expect(failThenSucceed).toHaveBeenCalledTimes(2)
            expect(await outbox.listPending()).toEqual([])
        })

        it('does not send a later op for the same entity while an earlier op on it is unresolved', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: { step: 1 } })
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: { step: 2 } })

            const pushFn = vi.fn(async (ops: OutboxOp[]) => {
                expect(ops).toHaveLength(1)
                expect((ops[0].payload as { step: number }).step).toBe(1)
                return [{ opId: ops[0].opId, status: 'rejected' as const }]
            })

            await outbox.flush(pushFn)
            expect(pushFn).toHaveBeenCalledTimes(1)
        })

        it('does not block an independent entity behind another entity currently in backoff', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            await outbox.flush(async (ops) => ops.map((op) => ({ opId: op.opId, status: 'rejected' as const })))

            await outbox.enqueue({ entity: 'account:acc2', operation: 'update', payload: {} })

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)

            expect(pushFn).toHaveBeenCalledTimes(1)
            const sentEntities = (pushFn.mock.calls[0][0] as OutboxOp[]).map((op) => op.entity)
            expect(sentEntities).toEqual(['account:acc2'])
        })
    })

    describe('offline behavior', () => {
        it('is a no-op when offline', async () => {
            setOnline(false)
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: {} })

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)

            expect(pushFn).not.toHaveBeenCalled()
            expect(await outbox.listPending()).toHaveLength(1)
        })

        it('flushes all pending ops in order once back online', async () => {
            setOnline(false)
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: {} })
            await outbox.enqueue({ entity: 'transaction:txn2', operation: 'create', payload: {} })

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)
            expect(pushFn).not.toHaveBeenCalled()

            setOnline(true)
            await outbox.flush(pushFn)

            expect(pushFn).toHaveBeenCalledTimes(1)
            const sentOps = pushFn.mock.calls[0][0] as OutboxOp[]
            expect(sentOps.map((op) => op.entity)).toEqual(['transaction:txn1', 'transaction:txn2'])
        })

        it('rejects enqueueing a workspace-scoped write while offline', async () => {
            setOnline(false)

            await expect(
                outbox.enqueue({
                    entity: 'transaction:txn1',
                    operation: 'create',
                    payload: { workspaceId: 'ws1', amount: 100 },
                })
            ).rejects.toThrow(/requires connectivity|offline|connection/i)

            expect(await outbox.listPending()).toEqual([])
        })

        it('queues personal (non-workspace) writes normally while offline', async () => {
            setOnline(false)

            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: { amount: 100 } })

            expect(await outbox.listPending()).toHaveLength(1)
        })

        it('accepts workspace-scoped writes when online', async () => {
            await outbox.enqueue({
                entity: 'transaction:txn1',
                operation: 'create',
                payload: { workspaceId: 'ws1', amount: 100 },
            })

            expect(await outbox.listPending()).toHaveLength(1)
        })
    })

    describe('push result handling', () => {
        it('marks a rejected op with an incremented attempt count and keeps it pending', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            const [{ opId }] = await outbox.listPending()

            await outbox.flush(async () => [{ opId, status: 'rejected' }])

            const [pendingOp] = await outbox.listPending()
            expect(pendingOp.attempts).toBe(1)
        })

        it('removes conflicted ops from the pending outbox instead of retrying them', async () => {
            await outbox.enqueue({
                entity: 'account:acc1',
                operation: 'update',
                payload: {},
                baseUpdatedAt: '2026-01-01T00:00:00.000Z',
            })
            const [{ opId }] = await outbox.listPending()

            await outbox.flush(async () => [{ opId, status: 'conflict' }])

            expect(await outbox.listPending()).toEqual([])
        })

        it('markFailed records the error and increments attempts directly', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            const [{ opId }] = await outbox.listPending()

            await outbox.markFailed(opId, 'network timeout')

            const [pendingOp] = await outbox.listPending()
            expect(pendingOp.attempts).toBe(1)
            expect(pendingOp.lastError).toBe('network timeout')
        })
    })

    // BUG-32: a server-rejected op must record *why* it was rejected, cap its backoff so it can
    // still recover on its own, and be individually retryable / discardable.
    describe('BUG-32 - rejected ops surface the reason and stay recoverable', () => {
        it('stores the server rejection message on the rejected op as lastError', async () => {
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: {} })
            const [{ opId }] = await outbox.listPending()

            await outbox.flush(async () => [
                { opId, status: 'rejected' as const, message: 'Account not found' },
            ])

            const [pendingOp] = await outbox.listPending()
            expect(pendingOp.lastError).toBe('Account not found')
            expect(pendingOp.attempts).toBe(1)
        })

        it('falls back to a readable message when the server sends none', async () => {
            await outbox.enqueue({ entity: 'transaction:txn1', operation: 'create', payload: {} })
            const [{ opId }] = await outbox.listPending()

            await outbox.flush(async () => [{ opId, status: 'id_conflict' as const }])

            const [pendingOp] = await outbox.listPending()
            expect(pendingOp.lastError).toMatch(/ID is already used|rejected/i)
        })

        it('caps the retry backoff so a stuck op still retries within minutes, not years', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            const [{ opId }] = await outbox.listPending()

            const rejecting = vi.fn(async () => [{ opId, status: 'rejected' as const, message: 'nope' }])

            // Drive attempts way up - uncapped this would push nextAttemptAt years out.
            for (let i = 0; i < 40; i++) {
                await outbox.flush(rejecting)
                vi.advanceTimersByTime(6 * 60 * 1000)
            }

            const [pendingOp] = await outbox.listPending()
            const waitMs = (pendingOp.nextAttemptAt ?? 0) - Date.now()
            expect(waitMs).toBeLessThanOrEqual(5 * 60 * 1000)
        })

        it('retry(opId) clears the error and backoff so the next flush re-sends the op', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            const [{ opId }] = await outbox.listPending()

            await outbox.flush(async () => [{ opId, status: 'rejected' as const, message: 'transient' }])
            let [pendingOp] = await outbox.listPending()
            expect(pendingOp.nextAttemptAt).not.toBeNull()

            await outbox.retry(opId)
            pendingOp = (await outbox.listPending())[0]
            expect(pendingOp.lastError).toBeNull()
            expect(pendingOp.nextAttemptAt).toBeNull()

            const pushFn = vi.fn(applyAll)
            await outbox.flush(pushFn)
            expect(pushFn).toHaveBeenCalledTimes(1)
            expect(await outbox.listPending()).toEqual([])
        })

        it('discard(opId) drops the stuck op from the queue', async () => {
            await outbox.enqueue({ entity: 'account:acc1', operation: 'update', payload: {} })
            await outbox.enqueue({ entity: 'account:acc2', operation: 'update', payload: {} })
            const [first] = await outbox.listPending()

            await outbox.discard(first.opId)

            const remaining = await outbox.listPending()
            expect(remaining.map((op) => op.entity)).toEqual(['account:acc2'])
        })
    })
})
