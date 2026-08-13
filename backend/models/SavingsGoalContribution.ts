import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'

export const CONTRIBUTION_TYPES = ['manual', 'automatic'] as const
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number]

export interface ISavingsGoalContribution extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    goalId: Types.ObjectId
    amount: number
    type: ContributionType
    note?: string
    contributedAt: Date
    createdAt: Date
    updatedAt: Date
}

const SavingsGoalContributionSchema = new Schema<ISavingsGoalContribution>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavingsGoal', required: true },
        amount: { type: Number, required: true, min: 1 },
        type: { type: String, enum: CONTRIBUTION_TYPES, required: true },
        note: { type: String, trim: true },
        contributedAt: { type: Date, required: true, default: Date.now },
    },
    { timestamps: true }
)

SavingsGoalContributionSchema.index({ goalId: 1, contributedAt: -1 })
SavingsGoalContributionSchema.index({ userId: 1, goalId: 1, contributedAt: -1 })

applyRowLevelSecurity(SavingsGoalContributionSchema)

const SavingsGoalContribution: Model<ISavingsGoalContribution> =
    mongoose.model<ISavingsGoalContribution>('SavingsGoalContribution', SavingsGoalContributionSchema)
export default SavingsGoalContribution
