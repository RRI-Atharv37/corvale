import type { IUser, LegalAcceptance } from './user.model'
import { CURRENT_LEGAL_VERSIONS, PRIVACY_VERSION, TERMS_VERSION } from './legalVersions'

export const toPublicUser = (user: IUser) => ({
    _id: user._id,
    fullName: user.fullName,
    email: user.email,
    timezone: user.timezone,
    preferredCurrency: user.preferredCurrency,
    dateFormat: user.dateFormat,
    pageSize: user.pageSize,
    notificationPreferences: user.notificationPreferences,
    exchangeRates: user.exchangeRates,
    isEmailVerified: user.isEmailVerified,
    legalAcceptance: user.legalAcceptance,
    // The currently published versions ride along on every user payload so the client can tell
    // whether the stored acceptance is stale without a second round trip on each login (M0c).
    legalVersions: CURRENT_LEGAL_VERSIONS,
})

/**
 * Builds the acceptance record stamped onto a user at signup or re-acceptance. Versions come from
 * `legalVersions.ts`, never from the request body - see that file's header for why.
 */
export const buildLegalAcceptance = (): LegalAcceptance => ({
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: new Date(),
    ageAttested: true,
})
