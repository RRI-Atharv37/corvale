/** Typed RPC protocol between `SqliteWasmDriver` (main thread) and `sqliteWorker.ts`. */

export type WorkerPayload =
  | { type: 'open'; filename: string }
  | { type: 'exec'; sql: string; params?: unknown[] }
  | { type: 'select'; sql: string; params?: unknown[] }
  | { type: 'begin' }
  | { type: 'commit' }
  | { type: 'rollback' }
  | { type: 'close' }
  | { type: 'setEncryptionKey'; passphrase: string; salt: number[] }
  | { type: 'hasEncryptionKey' }
  | { type: 'clearEncryptionKey' }
  | { type: 'encryptValue'; plaintext: string }
  | { type: 'decryptValue'; iv: number[]; ciphertext: number[] }

export interface WorkerRequest {
  id: number
  payload: WorkerPayload
}

export type WorkerResponse = { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string }
