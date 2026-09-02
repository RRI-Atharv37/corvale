import asyncHandler from 'express-async-handler'
import bcrypt from 'bcryptjs'
import { Response } from 'express'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { handleResponses } from './authUtils'
import { generateAccessToken } from './tokenUtils'
import { isDesktopClientRequest } from '@infra/config/corsOriginAllowlist'
import { generateOfflineGrant } from './offlineGrantUtils'
import {
    createRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokensForUser,
    rotateRefreshToken,
} from './refreshToken.service'
import {
    buildPasswordResetUrl,
    createPasswordResetForUser,
    logPasswordResetLink,
    resetPasswordWithToken,
} from './passwordResetUtils'
import {
    buildEmailVerificationUrl,
    createEmailVerificationForUser,
    logEmailVerificationLink,
    verifyEmailWithToken,
} from './emailVerificationUtils'
import { isSmtpConfigured, sendPasswordResetEmail, sendEmailVerificationEmail } from '@infra/mail/mailService'
import { isValidTimezone } from '@core/time/timezoneUtils'
import { normalizeEmail } from '@infra/mail/emailUtils'
import { validatePassword } from './passwordPolicy'
import { verifyCaptcha } from '@infra/security/captchaService'
import { getRefreshTokenFromRequest, getRefreshTokenFromRequestBody, setRefreshTokenCookie, clearRefreshTokenCookie } from "@infra/config/refreshCookie";
import { IUser, User } from "@modules/users";
import { buildLegalAcceptance, toPublicUser } from "@modules/users/userSerialization";

/**
 * SEC-32: bcrypt hash of an unguessable constant, compared against the supplied password when
 * no user matches the login email so `POST /auth/login` spends the same ~cost-12 time whether
 * or not the address is registered. Without it, an unknown email returns before any hash runs
 * and the timing gap is a reliable account-existence oracle. Computed once at module load.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('corvale::no-such-account::timing-equalizer', 12)

/**
 * `includeRefreshTokenInBody` is set for the desktop (Tauri) client only (SEC-11 / BUG-24): it is
 * cross-site to the API and never gets the `SameSite=Lax` refresh cookie back, so it also receives
 * the refresh token in the response body to persist in the OS keychain. The cookie is still set
 * regardless — harmless for the desktop webview, and keeps the web path byte-identical.
 */
const issueAuthSession = async (
    user: IUser,
    res: Response,
    options: { includeRefreshTokenInBody?: boolean } = {}
) => {
    const accessToken = generateAccessToken(user._id.toString(), user.tokenVersion)
    const refreshToken = await createRefreshToken(user._id.toString())
    setRefreshTokenCookie(res, refreshToken)

    return {
        token: accessToken,
        user: toPublicUser(user),
        offlineGrant: generateOfflineGrant(user._id.toString()),
        ...(options.includeRefreshTokenInBody ? { refreshToken } : {}),
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

    const payload = await issueAuthSession(user, res, {
        includeRefreshTokenInBody: isDesktopClientRequest(req),
    })

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

    const payload = await issueAuthSession(user, res, {
        includeRefreshTokenInBody: isDesktopClientRequest(req),
    })
    handleResponses(res, 200, payload)
})

export const refreshAccessToken = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    // Desktop clients present the refresh token in the request body (SEC-11 / BUG-24); the web
    // app relies on the httpOnly cookie. Prefer the body token so a stale desktop cookie can't
    // shadow it.
    const rawRefreshToken =
        getRefreshTokenFromRequestBody(req.body) ?? getRefreshTokenFromRequest(req.cookies ?? {})

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
        ...(isDesktopClientRequest(req) ? { refreshToken: newRefreshToken } : {}),
    })
})

export const logoutUser = asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const rawRefreshToken =
        getRefreshTokenFromRequestBody(req.body) ?? getRefreshTokenFromRequest(req.cookies ?? {})

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
