import Account from '../models/Account'
import { toMinorUnits } from '@shared/money'

export interface MigrateAccountBalancesOptions {
    dryRun?: boolean
}

export interface MigrateAccountBalancesResult {
    dryRun: boolean
    accountsMigrated: number
    accountsSkipped: number
}

/**
 * One-time conversion of Account.openingBalance/currentBalance from
 * major-unit floats to integer minor units (Sprint C5), mirroring the
 * storage format Transaction.amount already uses. Idempotency is tracked
 * per-account via balanceUnit (Account.ts) rather than inspecting the
 * numeric value — an already-minor balance and an unconverted major balance
 * can both be valid integers (e.g. $50 vs 5000 cents), so the flag is the
 * only reliable signal. Every account not yet flagged 'minor' is converted
 * and flagged, regardless of when it was created; accounts already flagged
 * 'minor' are left untouched.
 *
 * Wire safety (BUG-17): both the REST /accounts contract
 * (accountController.serializeAccount) and the /api/v1/sync bootstrap/pull/
 * push-conflict paths emit Account balances as major-unit decimals with
 * balanceUnit 'major' regardless of storage (accountWireFormat.ts). A
 * migrated account therefore syncs down to an offline/desktop client
 * (VITE_LOCAL_FIRST) unchanged from the client's point of view — the local
 * engine, which assumes major units throughout, never sees the minor-unit
 * form. This is what makes running the migration against a live deployment
 * safe; the frontend domain engine itself was deliberately left major-only.
 */
export const migrateAccountBalancesToMinorUnits = async (
    options: MigrateAccountBalancesOptions = {}
): Promise<MigrateAccountBalancesResult> => {
    const dryRun = options.dryRun ?? false

    const accounts = await Account.find({})

    let accountsMigrated = 0
    let accountsSkipped = 0

    for (const account of accounts) {
        if (account.balanceUnit === 'minor') {
            accountsSkipped += 1
            continue
        }

        accountsMigrated += 1

        if (dryRun) {
            continue
        }

        account.openingBalance = toMinorUnits(account.openingBalance)
        account.currentBalance = toMinorUnits(account.currentBalance)
        account.balanceUnit = 'minor'
        await account.save()
    }

    return { dryRun, accountsMigrated, accountsSkipped }
}
