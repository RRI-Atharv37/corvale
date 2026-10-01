import RefreshToken from './refreshToken.model'
import { User } from '@modules/users'
import { RLS_BYPASS } from '@core/access/rowLevelSecurity'

export interface SessionRevocationResult {
    refreshTokensRevoked: number
    usersInvalidated: number
}

/**
 * SEC-95: the only real global logout. Rotating `JWT_SECRET` ends nothing - refresh tokens are random
 * values stored as hashes, so each one still mints an access token under the new secret. This revokes
 * every live refresh token and bumps every `tokenVersion`, which also kills outstanding access tokens.
 * System-wide by design, hence the RLS bypass; it is only reachable from `scripts/revokeAllSessions.ts`.
 */
export const revokeAllSessions = async ({ dryRun = false }: { dryRun?: boolean } = {}): Promise<SessionRevocationResult> => {
    const live = { revokedAt: null }

    if (dryRun) {
        return {
            refreshTokensRevoked: await RefreshToken.countDocuments(live).setOptions({ [RLS_BYPASS]: true }),
            usersInvalidated: await User.countDocuments({}),
        }
    }

    const tokens = await RefreshToken.updateMany(live, { revokedAt: new Date() }).setOptions({ [RLS_BYPASS]: true })
    const users = await User.updateMany({}, { $inc: { tokenVersion: 1 } })
    return { refreshTokensRevoked: tokens.modifiedCount, usersInvalidated: users.modifiedCount }
}
