import mongoose, {Document, Types, Schema, Model } from "mongoose"

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'
import { applySoftDelete } from '@core/softDelete/applySoftDelete'

export interface ISaver extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    saverAmount?: number
    pushoverAmount?: number
    saverDate?: Date
    deletedAt?: Date | null
}

const SaverSchema = new Schema<ISaver>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    saverAmount: { type: Number, required: true },
    pushoverAmount: { type: Number, default: 0 },
    saverDate: { type: Date, default: Date.now },
}, { timestamps: true })

SaverSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } })
SaverSchema.index({ userId: 1, updatedAt: 1, _id: 1 })

applyRowLevelSecurity(SaverSchema)
applySoftDelete(SaverSchema)

const Saver: Model<ISaver> = mongoose.model<ISaver>('Saver', SaverSchema)
export default Saver