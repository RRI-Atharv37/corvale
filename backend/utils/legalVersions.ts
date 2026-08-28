/**
 * Single source of truth for the published legal document versions (M0c).
 *
 * The server - never the client - stamps these onto `User.legalAcceptance` at signup and on
 * re-acceptance. A client-supplied version is ignored, so the stored record is evidence of what
 * was actually published rather than whatever the browser claimed it had rendered.
 *
 * Versions are the document's effective date, which is what the documents themselves print in
 * their front block and what a reader would cite. Bump the relevant constant whenever a document
 * changes *materially* - anything a reasonable user would want to re-read. A typo fix is not a
 * material change and should not force everyone through the re-consent gate.
 *
 * Bumping either value makes every existing acceptance stale, and `LegalGate` on the frontend
 * blocks the dashboard until the user accepts again. That is the intended behaviour, not a
 * side effect - so bump deliberately.
 *
 * The canonical text lives in `frontend/corvale/src/legal/`, surfaced through `docs/legal/` and
 * the app's own routes.
 */

export const TERMS_VERSION = '2026-08-28'
export const PRIVACY_VERSION = '2026-08-28'

/** Shipped on every user payload so the client can compare without a second round trip. */
export const CURRENT_LEGAL_VERSIONS = {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
} as const

export interface LegalAcceptanceRecord {
    termsVersion: string
    privacyVersion: string
    acceptedAt: Date
    ageAttested: boolean
}

/**
 * True when the stored acceptance matches both current versions. An absent record - every
 * account created before this shipped - is deliberately *not* up to date, which is how those
 * users get prompted exactly once without a migration script.
 */
export const isLegalAcceptanceCurrent = (
    acceptance?: Pick<LegalAcceptanceRecord, 'termsVersion' | 'privacyVersion'> | null
): boolean =>
    !!acceptance &&
    acceptance.termsVersion === TERMS_VERSION &&
    acceptance.privacyVersion === PRIVACY_VERSION
