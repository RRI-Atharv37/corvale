import { fromMinorUnits } from '../../shared/src/money'

interface AccountBalanceFields {
    openingBalance: number
    currentBalance: number
    balanceUnit?: 'major' | 'minor'
}

/**
 * `Account.openingBalance`/`currentBalance` are stored in the unit named by
 * `balanceUnit` (Account.ts) — 'major' decimals for accounts predating Sprint
 * C5's migration, integer 'minor' units after. Every client-facing surface —
 * the REST API (`accountController.serializeAccount`) and the `/sync` wire
 * format alike — emits these two fields as major-unit decimals so a consumer
 * never has to branch on the flag. The local-first engine in particular assumes
 * major-unit account balances throughout (`frontend/corvale/src/domain/*`), so
 * handing it minor units silently inflates every displayed balance 100x
 * (BUG-17).
 */
export const toMajorUnitBalances = (
    account: AccountBalanceFields
): { openingBalance: number; currentBalance: number } =>
    account.balanceUnit === 'minor'
        ? {
              openingBalance: fromMinorUnits(account.openingBalance),
              currentBalance: fromMinorUnits(account.currentBalance),
          }
        : { openingBalance: account.openingBalance, currentBalance: account.currentBalance }

/**
 * Normalizes a plain Account object (`.toObject()` / lean output) for the
 * `/sync` wire format: balances forced to major units *and* `balanceUnit` reset
 * to `'major'` so the emitted document is internally consistent — the sync
 * client stores the whole doc as an opaque blob, so a leftover
 * `balanceUnit: 'minor'` next to already-converted major numbers would be a
 * latent trap. A doc with no `balanceUnit` (i.e. any non-account entity, or an
 * unmigrated account) is returned untouched.
 */
export const serializeAccountDocForWire = <T extends Record<string, unknown>>(doc: T): T => {
    if (doc.balanceUnit !== 'minor') {
        return doc
    }
    return {
        ...doc,
        ...toMajorUnitBalances(doc as unknown as AccountBalanceFields),
        balanceUnit: 'major',
    }
}
