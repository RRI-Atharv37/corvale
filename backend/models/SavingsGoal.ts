import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '../utils/currencyUtils'

export const SAVINGS_GOAL_STATUSES = ['active', 'paused', 'completed', 'archived'] as const
export type SavingsGoalStatus = (typeof SAVINGS_GOAL_STATUSES)[number]

export const AUTO_CONTRIBUTION_INTERVALS = ['weekly', 'monthly'] as const
export type AutoContributionInterval = (typeof AUTO_CONTRIBUTION_INTERVALS)[number]

export interface IAutoContribution {
    enabled: boolean
    amount: number
    interval: AutoContributionInterval
    dayOfMonth?: number
    lastContributedAt?: Date
}

export interface ISavingsGoal extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    name: string
    targetAmount: number
    currentAmount: number
    currency: string
    targetDate?: Date | null
    status: SavingsGoalStatus
    accountId?: Types.ObjectId | null
    autoContribution: IAutoContribution
    completedAt?: Date | null
    createdAt: Date
    updatedAt: Date
}

const AutoContributionSchema = new Schema<IAutoContribution>(
    {
        enabled: { type: Boolean, default: false },
        amount: { type: Number, default: 0, min: 0 },
        interval: {
            type: String,
            enum: AUTO_CONTRIBUTION_INTERVALS,
            default: 'monthly',
        },
        dayOfMonth: { type: Number, min: 1, max: 28 },
        lastContributedAt: { type: Date },
    },
    { _id: false }
)

const SavingsGoalSchema = new Schema<ISavingsGoal>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        name: { type: String, required: true, trim: true },
        targetAmount: { type: Number, required: true, min: 1 },
        currentAmount: { type: Number, required: true, default: 0, min: 0 },
        currency: {
            type: String,
            enum: SUPPORTED_CURRENCIES,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
        },
        targetDate: { type: Date, default: null },
        status: {
            type: String,
            enum: SAVINGS_GOAL_STATUSES,
            required: true,
            default: 'active',
        },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
        autoContribution: { type: AutoContributionSchema, default: () => ({}) },
        completedAt: { type: Date, default: null },
    },
    { timestamps: true }
)

SavingsGoalSchema.index({ userId: 1, status: 1, createdAt: -1 })
SavingsGoalSchema.index({ userId: 1, targetDate: 1 })
SavingsGoalSchema.index({ userId: 1, updatedAt: 1, _id: 1 })
SavingsGoalSchema.index({ workspaceId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(SavingsGoalSchema, { supportsWorkspace: true })

const SavingsGoal: Model<ISavingsGoal> = mongoose.model<ISavingsGoal>(
    'SavingsGoal',
    SavingsGoalSchema
)
export default SavingsGoal
