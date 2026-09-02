/**
 * Dev-only console logging of password-reset / email-verification links (SEC-69).
 *
 * Fail-closed: the link is logged only when an operator explicitly sets `MAIL_DEV_LOG=true`,
 * never merely because `NODE_ENV` isn't `production`. The raw token is redacted from the URL
 * regardless — a working account-takeover token must never reach stdout or a log driver.
 */

export const isMailDevLogEnabled = (): boolean => process.env.MAIL_DEV_LOG === 'true'

export const redactUrlToken = (url: string): string =>
    url.replace(/([?&]token=)[^&#]+/gi, '$1[redacted]')

export const logMailDevLink = (label: string, email: string, url: string): void => {
    if (!isMailDevLogEnabled()) {
        console.info(`[${label}] link generated for ${email}`)
        return
    }
    console.info(`[${label}] ${email}: ${redactUrlToken(url)} (set MAIL_DEV_LOG=false to silence)`)
}
