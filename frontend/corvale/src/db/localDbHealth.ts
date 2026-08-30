/**
 * Tracks whether the persistent local database opened cleanly this session (BUG-30).
 *
 * `bootstrapLocalDb` marks the store "damaged" when the driver fails to open, migrate, or pass a
 * read probe - replacing the old silent fall-through to an in-memory driver that left every
 * local-first page showing a bare "Failed to load local data" with nothing to act on.
 * `LocalDbRecoveryGate` reads this to block the dashboard behind an explicit rebuild-from-server
 * flow, and marks it healthy again once the rebuild succeeds.
 *
 * Session-scoped module state, deliberately not persisted: a reload re-runs `bootstrapLocalDb`,
 * which re-detects a still-unreadable file or - after a successful rebuild - opens it cleanly.
 */
export type LocalDbHealth = 'ok' | 'damaged'

let health: LocalDbHealth = 'ok'
let damageReason: string | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  listeners.forEach((listener) => listener())
}

export const getLocalDbHealth = (): LocalDbHealth => health

export const getLocalDbDamageReason = (): string | null => damageReason

export const markLocalDbDamaged = (reason: string): void => {
  health = 'damaged'
  damageReason = reason
  notify()
}

export const markLocalDbHealthy = (): void => {
  if (health === 'ok') return
  health = 'ok'
  damageReason = null
  notify()
}

/** Subscribe to health transitions (for `useSyncExternalStore` in `LocalDbRecoveryGate`). */
export const subscribeLocalDbHealth = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: reset module state between cases. */
export const resetLocalDbHealthForTests = (): void => {
  health = 'ok'
  damageReason = null
  listeners.clear()
}
