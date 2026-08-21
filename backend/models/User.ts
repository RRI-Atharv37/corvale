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
    onboardingStarted: boolean
    onboardingCompleted: boolean
    onboardingSkipped: boolean
    onboardingCurrentStep: OnboardingStep | null
    onboardingStepsCompleted: string[]
    comparePassword(candidatePassword: string): Promise<boolean>
}

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
    passwordResetTokenHash: { type: String },
    passwordResetExpires: { type: Date },
    onboardingStarted: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    onboardingSkipped: { type: Boolean, default: false },
    onboardingCurrentStep: { type: String, default: null },
    onboardingStepsCompleted: { type: [String], default: [] },
    }, {timestamps: true}
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