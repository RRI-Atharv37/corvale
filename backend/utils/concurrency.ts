/**
 * Runs `fn` over `items` with at most `limit` promises in flight at once, preserving input order
 * in the result. Use where a per-item DB round-trip would otherwise fan out unbounded through
 * `Promise.all(items.map(...))` on a caller-controlled array (SEC-61).
 *
 * On the first rejection the remaining workers stop pulling new items and the returned promise
 * rejects with that error (in-flight items already started still settle, but their outcome is
 * ignored) — so a bad item does not leave a trail of unhandled rejections.
 */
export const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
    const results = new Array<R>(items.length)
    const workerCount = Math.max(1, Math.min(limit, items.length))
    let cursor = 0
    let failed = false

    const runWorker = async (): Promise<void> => {
        while (cursor < items.length && !failed) {
            const index = cursor
            cursor += 1
            try {
                results[index] = await fn(items[index], index)
            } catch (error) {
                failed = true
                throw error
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, runWorker))
    return results
}
