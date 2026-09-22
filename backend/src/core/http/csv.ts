/**
 * A minimal, framework-agnostic CSV row builder. Deliberately not shared with
 * `modules/transactions/transactionUtils.ts`'s `buildCsvRow`: the admin module may import only
 * `billing`/`users`/`workspaces` (`adminBoundary.test.ts`), so a `core/` copy is the correct home
 * for anything the admin module needs to format CSV with, rather than reaching into `transactions`.
 */
const escapeCsvValue = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export const buildCsvRow = (row: (string | number)[]): string => row.map((value) => escapeCsvValue(String(value))).join(',')
