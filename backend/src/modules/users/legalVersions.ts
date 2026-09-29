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

// 2026-09-28 (M0c, billing go-live): Subscription Terms replaced the "hosted service is free"
// stub in terms.md (price, trial, auto-renewal, cancellation, retention window) and introduced
// the new Refund Policy it points to; privacy.md gained the billing/Merchant-of-Record
// disclosures (Paddle as sub-processor, the billing ledger, operator/admin access). Both are
// material, so both versions bump together, and the Cookie Policy rides PRIVACY_VERSION again -
// same reasoning as the S31 note below, not a change of its own this time.
export const TERMS_VERSION = '2026-09-28'
// 2026-09-29: cookies.md and privacy.md now disclose Paddle's checkout script on the separate
// payment page (pay.corvale.app), which made "hCaptcha is the only third party" untrue. The
// 2026-09-28 versions had not been released, so this rides the same first-release re-consent.
// 2026-09-01 (S31 / SEC-46): the Cookie Policy's browser-encryption wording was corrected to
// reflect that promoted columns (amounts, dates, names) stay plaintext on the device by design.
// The Cookie Policy is part of the privacy disclosures, so the bump rides PRIVACY_VERSION and
// fires LegalGate re-consent.
export const PRIVACY_VERSION = '2026-09-29'

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
