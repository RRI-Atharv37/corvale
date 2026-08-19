import SqliteWorker from './worker/sqliteWorker?worker'
import type { LocalDb, LocalDbRow } from './LocalDb'
import type { WorkerPayload, WorkerRequest, WorkerResponse } from './worker/workerProtocol'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * Main-thread `LocalDb` implementation backed by the OPFS SAHPool VFS. All
 * actual SQLite work happens in `sqliteWorker.ts`; this class is a thin RPC
 * client that correlates requests to responses by id. Used by the real app;
 * `MemorySqliteDriver` (not this) is what tests run against, since OPFS and
 * Workers aren't available under Vitest's happy-dom environment.
 */
export class SqliteWasmDriver implements LocalDb {
  private readonly worker: Worker
  private nextId = 1
  private readonly pending = new Map<number, PendingCall>()

  private constructor(worker: Worker) {
    this.worker = worker
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const call = this.pending.get(response.id)
      if (!call) {
        return
      }
      this.pending.delete(response.id)
      if (response.ok) {
        call.resolve(response.result)
      } else {
        call.reject(new Error(response.error))
      }
    }
  }

  static async create(filename = 'spndr.sqlite3'): Promise<SqliteWasmDriver> {
    const driver = new SqliteWasmDriver(new SqliteWorker())
    await driver.send({ type: 'open', filename })
    return driver
  }

  private send<T = unknown>(payload: WorkerPayload): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const request: WorkerRequest = { id, payload }
      this.worker.postMessage(request)
    })
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.send({ type: 'exec', sql, params })
  }

  async select<T extends LocalDbRow = LocalDbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.send<T[]>({ type: 'select', sql, params })
  }

  // Mirrors MemorySqliteDriver: BEGIN/COMMIT/ROLLBACK are driven manually
  // around the awaited callback rather than using sqlite-wasm's own
  // (synchronous-callback-only) transaction() wrapper.
  async transaction<T>(fn: (tx: LocalDb) => Promise<T>): Promise<T> {
    await this.send({ type: 'begin' })
    try {
      const result = await fn(this)
      await this.send({ type: 'commit' })
      return result
    } catch (error) {
      await this.send({ type: 'rollback' })
      throw error
    }
  }

  /** Derives the encryption key inside the worker; the key itself never leaves it. */
  async setEncryptionKey(passphrase: string, salt: Uint8Array): Promise<void> {
    await this.send({ type: 'setEncryptionKey', passphrase, salt: Array.from(salt) })
  }

  async close(): Promise<void> {
    await this.send({ type: 'close' })
    this.worker.terminate()
  }
}
