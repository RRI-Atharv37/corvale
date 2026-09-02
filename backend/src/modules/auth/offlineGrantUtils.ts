import jwt from 'jsonwebtoken'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'

/**
 * Server-signed offline session grant (S16, SEC-18). Replaces the old plain
 * `spndr_session_valid_until` localStorage date - a value the client could simply rewrite to
 * extend its own offline access forever - with a JWT the client can verify (via the public half
 * of this keypair, baked into the frontend build) but never mint or extend itself. Asymmetric
 * (ES256) rather than HMAC deliberately: an HMAC secret shared with the browser to let it verify
 * would also let it forge, defeating the point.
 */
export const OFFLINE_GRANT_ALGORITHM = 'ES256' as const

const DEFAULT_OFFLINE_GRANT_DAYS = 30

export const getOfflineGrantDays = (env: NodeJS.ProcessEnv = process.env): number => {
    const raw = env.OFFLINE_GRANT_DAYS
    const parsed = raw ? Number(raw) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OFFLINE_GRANT_DAYS
}

/** `.env` files can't hold real newlines in a single-line value, so the PEM is stored with
 * literal `\n` escapes and unescaped here - the same convention used by other PEM-in-env-var
 * setups (e.g. Firebase admin credentials). */
const readPrivateKey = (): string => {
    const raw = process.env.OFFLINE_GRANT_PRIVATE_KEY
    if (!raw) {
        throw new CustomError(ERROR_MESSAGES.GENERAL.OFFLINE_GRANT_KEY_MISSING, 500)
    }
    return raw.replace(/\\n/g, '\n')
}

export const generateOfflineGrant = (userId: string): string => {
    const privateKey = readPrivateKey()
    const days = getOfflineGrantDays()

    return jwt.sign({ sub: userId }, privateKey, {
        algorithm: OFFLINE_GRANT_ALGORITHM,
        expiresIn: `${days}d`,
    })
}
