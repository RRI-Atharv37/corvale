import { parseEncryptionKey } from '@core/auth/secretBox'
import { getRefreshCookieSameSite } from '@infra/config/refreshCookie'

const REQUIRED_ENV_VARS = [
    'MONGO_URI',
    'JWT_SECRET',
    'JWT_EXPIRY',
    'CLIENT_URL',
    'OFFLINE_GRANT_PRIVATE_KEY',
] as const

/**
 * Minimum `JWT_SECRET` length accepted when `NODE_ENV=production` (SEC-27). Short secrets are
 * brute-forceable offline once a single token is observed; below this a production deployment
 * refuses to start.
 */
export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32

/**
 * Secret values that ship *in the repo* - `backend/.env.example`, the getting-started docs - plus
 * a handful of universally-known weak defaults. Corvale is distributed for self-hosting and
 * `docker-compose.yml` instructs `cp backend/.env.example backend/.env`; a deployer who copies
 * the file and misses the `JWT_SECRET` line otherwise signs every access token with a string
 * published in a public repository. Anyone could then mint a token for an arbitrary `userId`
 * (the default `tokenVersion` is `0`, so a forged `tv: 0` passes the version check too) and read
 * or modify every user's transactions, balances, accounts and receipts (SEC-27).
 *
 * Compared case-insensitively and after trimming; see `isKnownPlaceholderSecret`.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
    'replace-with-a-long-random-string', // backend/.env.example JWT_SECRET
    'your-secret-key-here', // docs/getting-started/installation.md (pre-S20)
    'paste-a-generated-secret-here', // docs/getting-started/installation.md
    'paste-a-generated-secret', // common truncation of the above
    'replace-with-your-own-es256-private-key-pem-newlines-escaped-as-\\n', // .env.example OFFLINE_GRANT_PRIVATE_KEY
    'changeme',
    'change-me',
    'change_me',
    'secret',
    'jwt-secret',
    'jwtsecret',
    'jwt_secret',
    'password',
])

const isKnownPlaceholderSecret = (value: string): boolean =>
    KNOWN_PLACEHOLDER_SECRETS.has(value.trim().toLowerCase())

export const MIN_ADMIN_JWT_SECRET_LENGTH = 32

const isBareOrigin = (value: string): boolean => {
    try {
        const url = new URL(value)
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
    } catch {
        return false
    }
}

/**
 * The internal admin surface (M7) is the most privileged code in the repo, so a half-configured
 * deployment must not start: its own signing secret (never the user one), a locked-down origin and a
 * real encryption key for the stored authenticator secrets. Nothing here applies while it is switched off.
 */
const validateAdminEnv = (env: NodeJS.ProcessEnv): void => {
    if (env.ADMIN_ENABLED !== 'true') return

    const missing = ['ADMIN_JWT_SECRET', 'ADMIN_ORIGIN', 'ADMIN_TOTP_ENCRYPTION_KEY'].filter((key) => !env[key])
    if (missing.length > 0) {
        throw new Error(`ADMIN_ENABLED is true but these are not set: ${missing.join(', ')}`)
    }

    const adminSecret = env.ADMIN_JWT_SECRET as string
    if (adminSecret === env.JWT_SECRET) {
        throw new Error('ADMIN_JWT_SECRET must differ from JWT_SECRET: an admin token must never verify as a user token')
    }
    if (isKnownPlaceholderSecret(adminSecret) || adminSecret.length < MIN_ADMIN_JWT_SECRET_LENGTH) {
        throw new Error(
            `ADMIN_JWT_SECRET must be a unique random value of at least ${MIN_ADMIN_JWT_SECRET_LENGTH} characters`
        )
    }

    try {
        parseEncryptionKey(env.ADMIN_TOTP_ENCRYPTION_KEY as string)
    } catch {
        throw new Error(
            'ADMIN_TOTP_ENCRYPTION_KEY must be 32 bytes: 64 hex characters or base64, e.g. ' +
                `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
        )
    }

    const adminOrigin = env.ADMIN_ORIGIN as string
    if (!isBareOrigin(adminOrigin)) {
        throw new Error('ADMIN_ORIGIN must be a single http(s) origin with no path or trailing slash, e.g. https://admin.example.com')
    }
    const userOrigins = (env.CLIENT_URL as string).split(',').map((origin) => origin.trim())
    if (userOrigins.includes(adminOrigin)) {
        throw new Error('ADMIN_ORIGIN must be a different origin from the user app (CLIENT_URL)')
    }
}

/**
 * Fails startup loudly instead of degrading silently (SEC-12): an unset JWT_EXPIRY
 * previously issued non-expiring access tokens, an unset CLIENT_URL fell back to
 * CORS `*`, etc. Called at the top of `createApp()`.
 */
export const validateEnv = (env: NodeJS.ProcessEnv = process.env): void => {
    const missing = REQUIRED_ENV_VARS.filter((key) => !env[key])
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
    }

    // SEC-27: a presence-only check let a placeholder JWT_SECRET through. Reject the values that
    // ship in the repo/docs, plus obvious weak defaults, at boot and regardless of NODE_ENV -
    // the insecure path must fail loudly, not just quietly work.
    const jwtSecret = env.JWT_SECRET as string
    if (isKnownPlaceholderSecret(jwtSecret)) {
        throw new Error(
            'JWT_SECRET is still set to a placeholder / well-known value from .env.example or the ' +
                'docs. Generate a unique random secret before starting the server, e.g. ' +
                `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
        )
    }
    if (isKnownPlaceholderSecret(env.OFFLINE_GRANT_PRIVATE_KEY as string)) {
        throw new Error(
            'OFFLINE_GRANT_PRIVATE_KEY is still set to the .env.example placeholder. Generate a real ' +
                'EC keypair - see docs/developers/guides/environment-variables.md#offline-session-grant.'
        )
    }

    if (
        env.NODE_ENV === 'production' &&
        jwtSecret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH
    ) {
        throw new Error(
            `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters when ` +
                `NODE_ENV=production (current length: ${jwtSecret.length}).`
        )
    }

    // SEC-11: pins the deployment topology by validating REFRESH_COOKIE_SAME_SITE the same
    // way every other misconfiguration on this path fails - at boot, not as a mystery bug.
    getRefreshCookieSameSite(env)

    validateAdminEnv(env)
}
