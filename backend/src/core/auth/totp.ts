import { Secret, TOTP } from 'otpauth'

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
export const TOTP_DRIFT_STEPS = 1

interface TotpOptions {
    digits?: number
}

const buildTotp = (secretBase32: string, digits: number): TOTP =>
    new TOTP({ algorithm: 'SHA1', digits, period: TOTP_STEP_SECONDS, secret: Secret.fromBase32(secretBase32) })

export const generateTotpSecret = (): string => new Secret({ size: 20 }).base32

export const buildOtpauthUri = ({ secret, label, issuer }: { secret: string; label: string; issuer: string }): string =>
    new TOTP({
        issuer,
        label,
        algorithm: 'SHA1',
        digits: TOTP_DIGITS,
        period: TOTP_STEP_SECONDS,
        secret: Secret.fromBase32(secret),
    }).toString()

export const generateTotpCode = (secretBase32: string, timestampMs: number, options: TotpOptions = {}): string =>
    buildTotp(secretBase32, options.digits ?? TOTP_DIGITS).generate({ timestamp: timestampMs })

export type TotpVerification = { valid: true; step: number } | { valid: false }

/**
 * `step` is the absolute 30-second counter the token matched, so a caller can refuse to accept the same
 * step twice. Anything that is not exactly the expected number of digits is refused before it reaches the
 * library, so a malformed value can never throw.
 */
export const verifyTotp = (
    secretBase32: string,
    token: unknown,
    { timestampMs, digits = TOTP_DIGITS }: { timestampMs: number; digits?: number }
): TotpVerification => {
    if (typeof token !== 'string' || token.length !== digits || !/^\d+$/.test(token)) return { valid: false }

    const delta = buildTotp(secretBase32, digits).validate({ token, timestamp: timestampMs, window: TOTP_DRIFT_STEPS })
    if (delta === null) return { valid: false }

    return { valid: true, step: Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS) + delta }
}
