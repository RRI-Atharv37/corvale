export interface LocalDbRow {
  [column: string]: unknown
}

export interface LocalDb {
  exec(sql: string, params?: unknown[]): Promise<void>
  select<T extends LocalDbRow = LocalDbRow>(sql: string, params?: unknown[]): Promise<T[]>
  transaction<T>(fn: (tx: LocalDb) => Promise<T>): Promise<T>
  close(): Promise<void>
}
