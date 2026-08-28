import asyncHandler from 'express-async-handler'
import bcrypt from 'bcryptjs'
import { Response } from 'express'
import User, { IUser, LegalAcceptance } from '../models/User'
import { AuthRequest } from '../middleware/authTypes'
import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'
import { handleResponses } from '../utils/authUtils'
import {
    generateAccessToken,
    getRefreshTokenFromRequest,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
} from '../utils/tokenUtils'
import { generateOfflineGrant } from '../utils/offlineGrantUtils'
import {
    createRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokensForUser,
    rotateRefreshToken,
} from '../utils/refreshTokenService'
import {
    buildPasswordResetUrl,
    createPasswordResetForUser,
    logPasswordResetLink,
    resetPasswordWithToken,
} from '../utils/passwordResetUtils'
import {
    buildEmailVerificationUrl,
    createEmailVerificationForUser,
    logEmailVerificationLink,
    verifyEmailWithToken,
} from '../utils/emailVerificationUtils'
import { isSmtpConfigured, sendPasswordResetEmail, sendEmailVerificationEmail } from '../utils/mailService'
import { parseSupportedCurrency, syncUserCurrencyData } from '../utils/currencyUtils'
import { isValidTimezone } from '../utils/timezoneUtils'
import { parseNotificationPreferences } from '../utils/notificationUtils'
import { parseDateFormat, parsePageSize } from '../utils/userPreferencesUtils'
import { normalizeEmail } from '../utils/emailUtils'
import { validatePassword } from '../utils/passwordPolicy'
import { verifyCaptcha } from '../utils/captchaService'
import {
    assertAccountDeletionAllowed,
    computeAccountDeletionImpact,
    deleteUserAccountCascade,
} from '../utils/accountDeletionUtils'
import { CURRENT_LEGAL_VERSIONS, PRIVACY_VERSION, TERMS_VERSION } from '../utils/legalVersions'

/**
 * SEC-32: bcrypt hash of an unguessable constant, compared against the supplied password when
 * no user matches the login email so `POST /auth/login` spends the same ~cost-12 time whether
 * or not the address is registered. Without it, an unknown email returns before any hash runs
 * and the timing gap is a reliable account-existence oracle. Computed once at module load.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('corvale::no-such-account::timing-equalizer', 12)

const toPublicUser = (user: IUser) => ({
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
const buildLegalAcceptance = (): LegalAcceptance => ({
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: new Date(),
    ageAttested: true,
})

const issueAuthSession = async (user: IUser, res: Response) => {
    const accessToken = generateAccessToken(user._id.toString(), user.tokenVersion)
    const refreshToken = await createRefreshToken(user._id.toString())
    setRefreshTokenCookie(res, refreshToken)

    return {
        token: accessToken,
        user: toPublicUser(user),
        offlineGrant: generateOfflineGrant(user._id.toString()),
    }
}

/**
 * Mints a fresh email-verification token for `user` and delivers the link — over SMTP when it's
 * configured, otherwise to the console (dev). A send failure is logged, never surfaced, so it
 * can't become a probing oracle or a new outage mode.
 */
const dispatchEmailVerification = async (user: IUser): Promise<void> => {
    const verificationToken = await createEmailVerificationForUser(user)
    const verificationUrl = buildEmailVerificationUrl(verificationToken)

    if (isSmtpConfigured()) {
        try {
            await sendEmailVerificationEmail(user.email, verificationUrl)
        } catch (error) {
            console.error('[email-verification] failed to send email:', error)
        }
    } else {
        logEmailVerificationLink(user.email, verificationUrl)
    }
}

export const registerUser = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { fullName, email, password, timezone } = req.body

    if (!fullName || !email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    // Timezone is auto-detected client-side (V5) and sent in the signup payload - there is no
    // dropdown any more. It's not user-typed, so a bad value isn't worth failing signup over:
    // validate and keep it, otherwise fall through to the User model's 'UTC' default. `updateUserInfo`
    // (the once-per-session resync path) still hard-rejects an invalid timezone since that one is a
    // deliberate client call.
    const detectedTimezone =
        typeof timezone === 'string' && timezone.trim() && isValidTimezone(timezone.trim())
            ? timezone.trim()
            : undefined

    const normalizedEmail = normalizeEmail(email)
    const validatedPassword = validatePassword(password)

    const captchaOk = await verifyCaptcha(req.body.captchaToken)
    if (!captchaOk) {
        throw new CustomError(ERROR_MESSAGES.AUTH.CAPTCHA_FAILED, 400)
    }

    // Consent is checked last, after the field/password/captcha rules above, so a malformed
    // signup still reports the specific thing that was wrong with it rather than being masked by
    // a consent error. Both flags are required: the published policy and ToS assert that a user
    // agreed and is 18+, and a claim with no record behind it is worse than no claim (M0c2).
    if (req.body.acceptedTerms !== true) {
        throw new CustomError(ERROR_MESSAGES.AUTH.TERMS_NOT_ACCEPTED, 400)
    }

    if (req.body.ageAttested !== true) {
        throw new CustomError(ERROR_MESSAGES.AUTH.AGE_NOT_ATTESTED, 400)
    }

    const userExists = await User.findOne({ email: normalizedEmail })
    if (userExists) {
        // SEC-32: this response discloses that an address is registered. The enumeration-safe
        // alternative — accept the signup, issue no error, and reveal the collision only by
        // email — is incompatible with register auto-issuing a session so a fresh signup lands
        // on the in-app verify screen (V9). Accepted residual risk for v1.0.0; the mitigation
        // is the dedicated `auth-register` rate limiter (routes/authRoutes.ts), a separate
        // budget from login. Squatting a victim's address is bounded by the unverified-account
        // TTL on the User schema.
        throw new CustomError(ERROR_MESSAGES.USER.USER_ALREADY_EXISTS, 400)
    }

    const user = (await User.create({
        fullName,
        email: normalizedEmail,
        password: validatedPassword,
        ...(detectedTimezone ? { timezone: detectedTimezone } : {}),
        legalAcceptance: buildLegalAcceptance(),
    })) as IUser

    await dispatchEmailVerification(user)

    const payload = await issueAuthSession(user, res)

    handleResponses(res, 201, payload)
})

export const loginUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email, password } = req.body

    if (!email || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    if (typeof password !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    const normalizedEmail = normalizeEmail(email)

    const user = (await User.findOne({ email: normalizedEmail })) as IUser | null
    if (!user) {
        // SEC-32: burn the same bcrypt time a real account would, so "no such user" and
        // "wrong password" are not distinguishable by response latency.
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    // V9: unverified accounts are hard-blocked at login, not just at `protect`. No session is
    // issued; the client routes to the verify screen, where the unauthenticated resend form
    // gets them a fresh link.
    if (!user.isEmailVerified) {
        throw new CustomError(ERROR_MESSAGES.AUTH.EMAIL_NOT_VERIFIED, 403)
    }

    const payload = await issueAuthSession(user, res)
    handleResponses(res, 200, payload)
})

export const refreshAccessToken = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const rawRefreshToken = getRefreshTokenFromRequest(req.cookies ?? {})

    if (!rawRefreshToken) {
        throw new CustomError(ERROR_MESSAGES.AUTH.REFRESH_TOKEN_MISSING, 401)
    }

    const { userId, newRefreshToken } = await rotateRefreshToken(rawRefreshToken)
    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 401)
    }

    setRefreshTokenCookie(res, newRefreshToken)
    const accessToken = generateAccessToken(user._id.toString(), user.tokenVersion)

    handleResponses(res, 200, {
        token: accessToken,
        user: toPublicUser(user),
        offlineGrant: generateOfflineGrant(user._id.toString()),
    })
})

export const logoutUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const rawRefreshToken = getRefreshTokenFromRequest(req.cookies ?? {})

    if (rawRefreshToken) {
        await revokeRefreshToken(rawRefreshToken)
    }

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'Logged out successfully' })
})

export const logoutAllSessions = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const user = (await User.findById(userId)) as IUser | null
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    user.tokenVersion += 1
    await user.save()
    await revokeAllRefreshTokensForUser(userId)

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'All sessions revoked successfully' })
})

export const getUserInfo = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    handleResponses(res, 200, toPublicUser(user))
})

/**
 * Re-accept the current Terms and Privacy Policy (M0c). Backs the `LegalGate` prompt shown when
 * either version bumps, and the one-time prompt for accounts that predate the consent record.
 *
 * There is no body: the versions are the server's to stamp, and re-accepting necessarily
 * re-affirms the 18+ attestation the user made at signup.
 */
export const acceptLegalTerms = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    user.legalAcceptance = buildLegalAcceptance()
    await user.save()

    handleResponses(res, 200, toPublicUser(user))
})

export const updateUserPreferences = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id

    const user = (await User.findById(userId)) as IUser | null

    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const { fullName, preferredCurrency, dateFormat, pageSize, timezone, notificationPreferences } = req.body

    let preferredCurrencyChanged = false

    if (fullName !== undefined) {
        if (typeof fullName !== 'string' || !fullName.trim()) {
            throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_FULL_NAME, 400)
        }
        user.fullName = fullName.trim()
    }

    if (preferredCurrency !== undefined) {
        const nextCurrency = parseSupportedCurrency(preferredCurrency)
        preferredCurrencyChanged = nextCurrency !== user.preferredCurrency
        user.preferredCurrency = nextCurrency
    }

    if (dateFormat !== undefined) {
        user.dateFormat = parseDateFormat(dateFormat)
    }

    if (pageSize !== undefined) {
        user.pageSize = parsePageSize(pageSize)
    }

    if (timezone !== undefined) {
        if (typeof timezone !== 'string' || !timezone.trim() || !isValidTimezone(timezone.trim())) {
            throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_TIMEZONE, 400)
        }
        user.timezone = timezone.trim()
    }

    if (notificationPreferences !== undefined) {
        try {
            const parsed = parseNotificationPreferences(notificationPreferences)
            if (parsed) {
                user.notificationPreferences = {
                    ...user.notificationPreferences,
                    ...parsed,
                }
            }
        } catch (error) {
            throw new CustomError(
                error instanceof Error ? error.message : 'Invalid notification preferences',
                400
            )
        }
    }

    await user.save()

    if (preferredCurrencyChanged) {
        await syncUserCurrencyData(user._id, user.preferredCurrency)
    }

    handleResponses(res, 200, toPublicUser(user))
})

export const requestPasswordReset = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { email } = req.body

    if (!email) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const normalizedEmail = normalizeEmail(email)

    const resetToken = await createPasswordResetForUser(normalizedEmail)

    if (resetToken) {
        const resetUrl = buildPasswordResetUrl(resetToken)

        if (isSmtpConfigured()) {
            try {
                await sendPasswordResetEmail(normalizedEmail, resetUrl)
            } catch (error) {
                console.error('[password-reset] failed to send email:', error)
            }
        } else {
            logPasswordResetLink(normalizedEmail, resetUrl)
        }
    }

    handleResponses(res, 200, {
        message: ERROR_MESSAGES.AUTH.PASSWORD_RESET_EMAIL_SENT,
    })
})

export const confirmPasswordReset = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { token, password } = req.body

    if (!token || !password) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    const validatedPassword = validatePassword(password)

    try {
        await resetPasswordWithToken(token, validatedPassword)
    } catch (error) {
        if (error instanceof CustomError) {
            throw error
        }
        throw new CustomError(ERROR_MESSAGES.AUTH.PASSWORD_RESET_INVALID, 400)
    }

    handleResponses(res, 200, { message: 'Password reset successfully' })
})

export const confirmEmailVerification = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const { token } = req.body

    if (!token) {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    await verifyEmailWithToken(token)

    handleResponses(res, 200, { message: 'Email verified successfully' })
})

/**
 * Preview for the delete-account confirmation flow (Part 1) - lets the client show "N records in
 * M shared workspaces will stay in those workspaces but won't be linked to you anymore" before
 * the user commits to a password-confirmed, irreversible deletion. Read-only; no password check
 * needed since nothing is mutated.
 */
export const getAccountDeletionImpact = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const impact = await computeAccountDeletionImpact(userId)
    handleResponses(res, 200, impact)
})

export const deleteUserAccount = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?._id.toString()
    if (!userId) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const { password } = req.body
    if (!password || typeof password !== 'string') {
        throw new CustomError(ERROR_MESSAGES.AUTH.FILL_ALL_FIELDS, 400)
    }

    // req.user comes from authenticateRequest, which loads the user with `.select('-password')` -
    // re-fetch with the password field to verify it, same as loginUser.
    const user = (await User.findById(userId)) as IUser | null
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }

    const isMatch = await user.comparePassword(password)
    if (!isMatch) {
        throw new CustomError(ERROR_MESSAGES.AUTH.INVALID_CREDENTIALS, 400)
    }

    await assertAccountDeletionAllowed(userId)
    await deleteUserAccountCascade(userId)

    clearRefreshTokenCookie(res)
    handleResponses(res, 200, { message: 'Account deleted successfully' })
})

export const resendEmailVerification = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    // Authenticated caller — the in-app verify screen. Resolve to their own account and answer
    // precisely (including "already verified").
    if (req.user?._id) {
        const user = (await User.findById(req.user._id)) as IUser | null

        if (!user) {
            throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
        }

        if (user.isEmailVerified) {
            handleResponses(res, 200, { message: ERROR_MESSAGES.AUTH.EMAIL_ALREADY_VERIFIED })
            return
        }

        await dispatchEmailVerification(user)
        handleResponses(res, 200, { message: ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT })
        return
    }

    // Unauthenticated caller — a returning user blocked at login, so no token. Look up by email
    // and stay enumeration-safe: the response is identical whether or not that account exists or
    // is already verified.
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : ''
    if (email) {
        const user = (await User.findOne({ email })) as IUser | null
        if (user && !user.isEmailVerified) {
            await dispatchEmailVerification(user)
        }
    }

    handleResponses(res, 200, { message: ERROR_MESSAGES.AUTH.EMAIL_VERIFICATION_SENT })
})
