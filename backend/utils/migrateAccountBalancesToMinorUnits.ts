import Account from '../models/Account'
import { toMinorUnits } from '../../shared/src/money'

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
 * NOTE: any client syncing Account data offline (VITE_LOCAL_FIRST — see
 * ROADMAP.md's D4/local-first caveats) reads whatever unit is currently
 * stored via /api/v1/sync, with no conversion at that layer. Do not run
 * this against a deployment with active offline/desktop clients until the
 * frontend local-first engine has been updated to match — otherwise their
 * locally cached balances will read ~100x too large the next time they sync.
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
