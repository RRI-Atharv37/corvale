import mongoose, {Document, Types, Schema, Model } from "mongoose"

import { applyRowLevelSecurity } from '@core/access/applyRowLevelSecurity'

export interface IPushover extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    pushoverAmount: number
    pushoverDate: Date
}

const PushoverSchema = new Schema<IPushover>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pushoverAmount: { type: Number, required: true },
    pushoverDate: { type: Date, default: Date.now },
}, { timestamps: true })

applyRowLevelSecurity(PushoverSchema)

const Pushover: Model<IPushover> = mongoose.model<IPushover>('Pushover', PushoverSchema)
export default Pushover