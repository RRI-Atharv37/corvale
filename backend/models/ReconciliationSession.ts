import mongoose, { Document, Model, Schema, Types } from 'mongoose'
import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'

export interface IReconciliationSession extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    workspaceId?: Types.ObjectId | null
    accountId: Types.ObjectId
    statementEndDate: Date
    statementBalance: number
    clearedBalance: number
    pendingBalance: number
    balanceDifferential: number
    createdAt: Date
    updatedAt: Date
}

const ReconciliationSessionSchema = new Schema<IReconciliationSession>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', default: null },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
        statementEndDate: { type: Date, required: true },
        statementBalance: { type: Number, required: true },
        clearedBalance: { type: Number, required: true, default: 0 },
        pendingBalance: { type: Number, required: true, default: 0 },
        balanceDifferential: { type: Number, required: true, default: 0 },
    },
    { timestamps: true }
)

ReconciliationSessionSchema.index({ userId: 1, accountId: 1, statementEndDate: -1 })

applyRowLevelSecurity(ReconciliationSessionSchema, { supportsWorkspace: true })

const ReconciliationSession: Model<IReconciliationSession> = mongoose.model<IReconciliationSession>(
    'ReconciliationSession',
    ReconciliationSessionSchema
)

export default ReconciliationSession
