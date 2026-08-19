import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { BindingSpec, Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { LocalDb, LocalDbRow } from './LocalDb'

let sqlite3Promise: Promise<Sqlite3Static> | null = null

const getSqlite3 = (): Promise<Sqlite3Static> => {
  if (!sqlite3Promise) {
    sqlite3Promise = sqlite3InitModule()
  }
  return sqlite3Promise
}

export class MemorySqliteDriver implements LocalDb {
  private db: Database | null

  private constructor(db: Database) {
    this.db = db
  }

  static async create(): Promise<MemorySqliteDriver> {
    const sqlite3 = await getSqlite3()
    const db = new sqlite3.oo1.DB(':memory:', 'c')
    return new MemorySqliteDriver(db)
  }

  private get handle(): Database {
    if (!this.db) {
      throw new Error('MemorySqliteDriver used after close()')
    }
    return this.db
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    this.handle.exec({ sql, bind: params as BindingSpec })
  }

  async select<T extends LocalDbRow = LocalDbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.handle.selectObjects(sql, params as BindingSpec) as T[]
  }

  // sqlite-wasm's own Database#transaction() wraps a *synchronous* callback in
  // BEGIN/COMMIT/ROLLBACK, so it can't be used here: our LocalDb contract takes
  // an async callback, and awaiting inside a sync callback would let sqlite-wasm
  // issue COMMIT before the awaited work actually finishes. BEGIN/COMMIT/ROLLBACK
  // are therefore driven manually around the awaited callback instead.
  async transaction<T>(fn: (tx: LocalDb) => Promise<T>): Promise<T> {
    this.handle.exec('BEGIN')
    try {
      const result = await fn(this)
      this.handle.exec('COMMIT')
      return result
    } catch (error) {
      this.handle.exec('ROLLBACK')
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
