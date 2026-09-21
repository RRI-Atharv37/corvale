import { parseEncryptionKey } from '@core/auth/secretBox'

export const isAdminEnabled = (): boolean => process.env.ADMIN_ENABLED === 'true'

const positiveInt = (raw: string | undefined, fallback: number, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}): number => {
    const value = Number(raw)
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export const ADMIN_TOKEN_AUDIENCE = 'corvale-admin'
export const ADMIN_TOKEN_ISSUER = 'corvale-admin'
export const ADMIN_REFRESH_COOKIE = 'corvale_admin_refresh'
export const ADMIN_REFRESH_COOKIE_PATH = '/api/v1/admin/auth'

export const MIN_ADMIN_PASSWORD_LENGTH = 14
export const MAX_ADMIN_PASSWORD_BYTES = 72

export const ENROLMENT_TOKEN_TTL_MS = 15 * 60 * 1000
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const REENROL_MONEY_BLOCK_MS = 24 * 60 * 60 * 1000

export const getAdminJwtSecret = (): string => process.env.ADMIN_JWT_SECRET as string

export const getAdminTotpKey = (): ReturnType<typeof parseEncryptionKey> => parseEncryptionKey(process.env.ADMIN_TOTP_ENCRYPTION_KEY as string)

export const getAccessTokenTtlSeconds = (): number => positiveInt(process.env.ADMIN_ACCESS_TOKEN_TTL_SECONDS, 600, { min: 60, max: 3600 })
export const getSessionIdleMs = (): number => positiveInt(process.env.ADMIN_SESSION_IDLE_MINUTES, 30, { max: 240 }) * 60 * 1000
export const getSessionAbsoluteMs = (): number => positiveInt(process.env.ADMIN_SESSION_ABSOLUTE_HOURS, 8, { max: 24 }) * 60 * 60 * 1000
export const getStepUpWindowMs = (): number => positiveInt(process.env.ADMIN_STEP_UP_MINUTES, 5, { max: 15 }) * 60 * 1000
export const getMaxFailedLogins = (): number => positiveInt(process.env.ADMIN_MAX_FAILED_LOGINS, 5, { min: 3, max: 20 })
export const getLockoutMs = (): number => positiveInt(process.env.ADMIN_LOCKOUT_MINUTES, 15, { max: 1440 }) * 60 * 1000
export const getDetailViewsPerHour = (): number => positiveInt(process.env.ADMIN_DETAIL_VIEWS_PER_HOUR, 120)

/** Cost 12 in production; a lower cost is honoured only outside it so the suite stays fast. */
export const getBcryptRounds = (): number => {
    const configured = positiveInt(process.env.ADMIN_BCRYPT_ROUNDS, 12, { min: 4, max: 15 })
    return process.env.NODE_ENV === 'production' ? Math.max(configured, 12) : configured
}

export const getIpAllowlist = (): string[] | null => {
    const raw = process.env.ADMIN_IP_ALLOWLIST
    if (!raw || raw.trim() === '') return null
    return raw.split(',').map((entry) => normaliseIp(entry)).filter(Boolean)
}

export const normaliseIp = (ip: string | undefined): string => (ip ?? '').trim().replace(/^::ffff:/i, '')

export const getBootstrapSecretHash = (): string | null => process.env.ADMIN_BOOTSTRAP_SECRET_SHA256?.trim().toLowerCase() || null
export const getBreakGlassSecretHash = (): string | null => process.env.ADMIN_BREAKGLASS_SECRET_SHA256?.trim().toLowerCase() || null

export const MIN_RECOVERY_SECRET_LENGTH = 32

export const getGrantCapDays = (role: 'support' | 'finance' | 'owner'): number => {
    if (role === 'owner') return positiveInt(process.env.ADMIN_GRANT_CAP_DAYS_OWNER, 365, { max: 3650 })
    return positiveInt(process.env.ADMIN_GRANT_CAP_DAYS_SUPPORT, 30, { max: 365 })
}

export const MAX_ERASURE_HOLD_DAYS = 90
export const getErasureHoldCapDays = (role: 'support' | 'finance' | 'owner'): number =>
    Math.min(MAX_ERASURE_HOLD_DAYS, getGrantCapDays(role))
