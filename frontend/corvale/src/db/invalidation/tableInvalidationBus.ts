type InvalidationListener = () => void

/**
 * Replaces the legacy `window` CustomEvent bus in `utils/format.ts` for
 * local-store reads: any local write publishes the table(s) it touched, and
 * `useLocalQuery` (or anything else) subscribes per table instead of
 * fanning every change out to every listener on the page.
 */
class TableInvalidationBus {
  private readonly listeners = new Map<string, Set<InvalidationListener>>()

  subscribe(table: string, listener: InvalidationListener): () => void {
    let tableListeners = this.listeners.get(table)
    if (!tableListeners) {
      tableListeners = new Set()
      this.listeners.set(table, tableListeners)
    }
    tableListeners.add(listener)

    return () => {
      tableListeners?.delete(listener)
    }
  }

  publish(table: string): void {
    this.listeners.get(table)?.forEach((listener) => listener())
  }
}

export const tableInvalidationBus = new TableInvalidationBus()
