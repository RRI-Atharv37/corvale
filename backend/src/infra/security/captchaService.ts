export interface CaptchaVerifier {
    verify(token: string): Promise<boolean>
}

let testVerifier: CaptchaVerifier | null = null

/** Test-only hook to inject a fake verifier without a live provider call. */
export const setCaptchaVerifier = (verifier: CaptchaVerifier | null): void => {
    testVerifier = verifier
}

export const isCaptchaEnabled = (): boolean => process.env.CAPTCHA_ENABLED === 'true'

const buildProviderVerifier = (): CaptchaVerifier => {
    const secretKey = process.env.CAPTCHA_SECRET_KEY

    return {
        verify: async (token: string) => {
            if (!secretKey) return false

            const response = await fetch('https://hcaptcha.com/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ secret: secretKey, response: token }),
            })
            const result = (await response.json()) as { success: boolean }
            return result.success === true
        },
    }
}

const getVerifier = (): CaptchaVerifier => testVerifier ?? buildProviderVerifier()

/**
 * Always resolves true when CAPTCHA is disabled (today's behavior, byte-for-byte) — gated off
 * by default like every other env-driven seam in this codebase (ClamAV, Sentry, SMTP).
 */
export const verifyCaptcha = async (token: string | undefined): Promise<boolean> => {
    if (!isCaptchaEnabled()) return true
    if (!token) return false

    return getVerifier().verify(token)
}
