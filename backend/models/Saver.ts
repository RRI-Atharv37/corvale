import mongoose, {Document, Types, Schema, Model } from "mongoose"

export interface ISaver extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    saverAmount?: number
    pushoverAmount?: number
    saverDate?: Date
}

const SaverSchema = new Schema<ISaver>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    saverAmount: { type: Number, required: true },
    pushoverAmount: { type: Number, default: 0 },
    saverDate: { type: Date, default: Date.now },
}, { timestamps: true })

const Saver: Model<ISaver> = mongoose.model<ISaver>('Saver', SaverSchema)
export default Saver