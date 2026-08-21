const REQUIRED_ENV_VARS = ['MONGO_URI', 'JWT_SECRET', 'JWT_EXPIRY', 'CLIENT_URL'] as const

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
}
