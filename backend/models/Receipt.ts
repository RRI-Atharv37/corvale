import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface IReceipt extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    originalFilename: string
    storedFilename: string
    mimeType: string
    size: number
    createdAt: Date
    updatedAt: Date
}

const ReceiptSchema = new Schema<IReceipt>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        originalFilename: { type: String, required: true, trim: true },
        storedFilename: { type: String, required: true, trim: true },
        mimeType: { type: String, required: true, trim: true },
        size: { type: Number, required: true, min: 0 },
    },
    { timestamps: true }
)

ReceiptSchema.index({ userId: 1, createdAt: -1 })

const Receipt: Model<IReceipt> = mongoose.model<IReceipt>('Receipt', ReceiptSchema)
export default Receipt
