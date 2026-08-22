import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { BindingSpec, Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import { decryptField, deriveKey, encryptField } from '../encryption/deriveKey'
import type { WorkerPayload, WorkerRequest, WorkerResponse } from './workerProtocol'

/**
 * Runs entirely inside a dedicated Worker (spawned via `?worker` in
 * `SqliteWasmDriver`). The OPFS SAHPool VFS needs synchronous file access
 * handles, which browsers only expose off the main thread, so this worker -
 * not `SqliteWasmDriver` - is what actually owns the `Database` handle and
 * the encryption key (see `deriveKey.ts`'s "key held only in worker memory"
 * decision). SAHPool is used specifically because, unlike the plain OPFS VFS,
 * it doesn't require the page to be served with COOP/COEP cross-origin
 * isolation headers.
 *
 * Typed loosely against `self` rather than pulling the `webworker` lib into
 * the project's tsconfig (which already sets `lib: ["DOM", ...]` for the
 * main app and would conflict), since `MessageEvent` alone - already part of
 * `DOM` - is enough to type the RPC surface used here.
 */
const ctx = self as unknown as {
  postMessage: (message: WorkerResponse) => void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

const OPFS_VFS_NAME = 'spndr-opfs-sahpool'

let sqlite3: Sqlite3Static | null = null
let db: Database | null = null
let encryptionKey: CryptoKey | null = null

const getSqlite3 = async (): Promise<Sqlite3Static> => {
  if (!sqlite3) {
    sqlite3 = await sqlite3InitModule()
  }
  return sqlite3
}

const openDatabase = async (filename: string): Promise<void> => {
  const sqlite = await getSqlite3()
  const poolUtil = await sqlite.installOpfsSAHPoolVfs({ name: OPFS_VFS_NAME })
  db = new poolUtil.OpfsSAHPoolDb(filename)
}

const requireDb = (): Database => {
  if (!db) {
    throw new Error('SqliteWasmDriver worker used before open()')
  }
  return db
}

const dispatch = async (payload: WorkerPayload): Promise<unknown> => {
  switch (payload.type) {
    case 'open':
      await openDatabase(payload.filename)
      return undefined
    case 'exec':
      requireDb().exec({ sql: payload.sql, bind: (payload.params ?? []) as BindingSpec })
      return undefined
    case 'select':
      return requireDb().selectObjects(payload.sql, (payload.params ?? []) as BindingSpec)
    case 'begin':
      requireDb().exec('BEGIN')
      return undefined
    case 'commit':
      requireDb().exec('COMMIT')
      return undefined
    case 'rollback':
      requireDb().exec('ROLLBACK')
      return undefined
    case 'close':
      db?.close()
      db = null
      return undefined
    case 'setEncryptionKey':
      encryptionKey = await deriveKey(payload.passphrase, new Uint8Array(payload.salt))
      return undefined
    case 'hasEncryptionKey':
      return encryptionKey !== null
    case 'clearEncryptionKey':
      encryptionKey = null
      return undefined
    case 'encryptValue': {
      if (!encryptionKey) {
        throw new Error('Encryption key not set')
      }
      const { iv, ciphertext } = await encryptField(encryptionKey, payload.plaintext)
      return { iv: Array.from(iv), ciphertext: Array.from(ciphertext) }
    }
    case 'decryptValue': {
      if (!encryptionKey) {
        throw new Error('Encryption key not set')
      }
      return decryptField(encryptionKey, {
        iv: new Uint8Array(payload.iv),
        ciphertext: new Uint8Array(payload.ciphertext),
      })
    }
  }
}

ctx.onmessage = (event) => {
  const { id, payload } = event.data
  dispatch(payload)
    .then((result) => ctx.postMessage({ id, ok: true, result }))
    .catch((error: unknown) =>
      ctx.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
    )
}
