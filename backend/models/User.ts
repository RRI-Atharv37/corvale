import mongoose, {Document, Model, Schema, Types } from 'mongoose'
import bcrypt from 'bcryptjs'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES, SupportedCurrency } from '../utils/currencyUtils'
import {
    DEFAULT_DATE_FORMAT,
    DEFAULT_PAGE_SIZE,
    DATE_FORMATS,
    DateFormat,
    MAX_PAGE_SIZE,
    MIN_PAGE_SIZE,
} from '../utils/userPreferencesUtils'
import { OnboardingStep } from '../utils/onboardingUtils'
import { EMAIL_REGEX } from '../utils/emailUtils'

export interface NotificationPreferences {
    billRemindersEnabled: boolean
    billReminderDaysBefore: number
}

/**
 * Proof that this user accepted the published Terms and Privacy Policy, and attested to being 18
 * or older (M0c / M0c2). Versions are stamped by the server from `utils/legalVersions.ts` - the
 * client never asserts which version it agreed to.
 */
export interface LegalAcceptance {
    termsVersion: string
    privacyVersion: string
    acceptedAt: Date
    ageAttested: boolean
}

export interface IUser extends Document {
    _id: Types.ObjectId
    fullName: string
    email: string
    password: string
    timezone: string
    preferredCurrency: SupportedCurrency
    dateFormat: DateFormat
    pageSize: number
    notificationPreferences: NotificationPreferences
    exchangeRates: Record<string, number>
    tokenVersion: number
    passwordResetTokenHash?: string
    passwordResetExpires?: Date
    isEmailVerified: boolean
    emailVerificationTokenHash?: string
    emailVerificationExpires?: Date
    onboardingStarted: boolean
    onboardingCompleted: boolean
    onboardingSkipped: boolean
    onboardingCurrentStep: OnboardingStep | null
    onboardingStepsCompleted: string[]
    legalAcceptance?: LegalAcceptance
    comparePassword(candidatePassword: string): Promise<boolean>
}

const legalAcceptanceSchema = new Schema<LegalAcceptance>(
    {
        termsVersion: { type: String, required: true },
        privacyVersion: { type: String, required: true },
        acceptedAt: { type: Date, required: true },
        ageAttested: { type: Boolean, required: true },
    },
    { _id: false }
)

const userSchema = new Schema<IUser>({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: EMAIL_REGEX },
    password: { type: String, required: true },
    timezone: { type: String, default: 'UTC', trim: true },
    preferredCurrency: {
        type: String,
        enum: SUPPORTED_CURRENCIES,
        default: DEFAULT_CURRENCY,
        uppercase: true,
        trim: true,
    },
    dateFormat: {
        type: String,
        enum: DATE_FORMATS,
        default: DEFAULT_DATE_FORMAT,
        trim: true,
    },
    pageSize: {
        type: Number,
        default: DEFAULT_PAGE_SIZE,
        min: MIN_PAGE_SIZE,
        max: MAX_PAGE_SIZE,
    },
    notificationPreferences: {
        billRemindersEnabled: { type: Boolean, default: true },
        billReminderDaysBefore: { type: Number, default: 3, min: 0, max: 30 },
    },
    exchangeRates: { type: Schema.Types.Mixed, default: {} },
    tokenVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String },
    emailVerificationExpires: { type: Date },
    onboardingStarted: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    onboardingSkipped: { type: Boolean, default: false },
    onboardingCurrentStep: { type: String, default: null },
    onboardingStepsCompleted: { type: [String], default: [] },
    // Declared as a subdocument schema with `default: undefined` rather than a plain nested
    // object, because Mongoose materialises nested objects as `{}` on every document. Staying
    // genuinely absent is the point: "no record" is how accounts created before this shipped are
    // identified and prompted exactly once, with no migration script.
    legalAcceptance: { type: legalAcceptanceSchema, default: undefined },
    }, {timestamps: true}
)

/**
 * SEC-32 (account squatting): an unverified account still reserves its email address, so an
 * attacker can pre-register a victim's address and block the real signup (`USER_ALREADY_EXISTS`).
 * This partial TTL expires accounts that never verify after a grace window, releasing the
 * address. Once `isEmailVerified` flips to `true` the row no longer matches the partial filter
 * and is never a TTL candidate again. The window is generous (default 7 days) so a real user
 * who verifies late — the link itself lasts 10 min but resends restart it — is never caught;
 * an unverified account is dead weight anyway, blocked from login (V9) and every data route
 * (`protect`).
 */
const UNVERIFIED_ACCOUNT_TTL_SECONDS =
    Number(process.env.UNVERIFIED_ACCOUNT_TTL_SECONDS) || 7 * 24 * 60 * 60
userSchema.index(
    { createdAt: 1 },
    {
        expireAfterSeconds: UNVERIFIED_ACCOUNT_TTL_SECONDS,
        partialFilterExpression: { isEmailVerified: false },
    }
)

userSchema.pre<IUser>('save', async function (next) {
    if(!this.isModified('password')) return next()
    this.password = await bcrypt.hash(this.password, 12)
    next()
})

userSchema.methods.comparePassword = async function (candidatePassword: string) {
    return await bcrypt.compare(candidatePassword, this.password)
}

const User: Model<IUser> = mongoose.model<IUser>('User', userSchema)
export default User