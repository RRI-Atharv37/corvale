import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import type { PlanCode } from '@core/billing/constants'

export interface IPlan extends Document {
    _id: Types.ObjectId
    code: PlanCode
    name: string
    prices: { monthly: number | null; annual: number | null }
    features: { workspaces: boolean; prioritySupport: boolean; bankSync: boolean }
    limits: {
        receiptStorageBytes: number | null
        syncDevices: number | null
        workspaceMembers: number | null
    }
    createdAt: Date
    updatedAt: Date
}

const limit = { type: Number, default: null, min: 0 }
const price = { type: Number, default: null, min: 0 }
const feature = { type: Boolean, default: false }

const PlanSchema = new Schema<IPlan>(
    {
        code: { type: String, required: true, unique: true, trim: true, lowercase: true },
        name: { type: String, required: true, trim: true },
        prices: { monthly: price, annual: price },
        features: { workspaces: feature, prioritySupport: feature, bankSync: feature },
        limits: { receiptStorageBytes: limit, syncDevices: limit, workspaceMembers: limit },
    },
    { timestamps: true }
)

// System collection: no userId, so the row-level-security plugin is deliberately not applied
// (same footing as Workspace). Plan rows carry no user data.
const Plan: Model<IPlan> = mongoose.model<IPlan>('Plan', PlanSchema)
export default Plan
