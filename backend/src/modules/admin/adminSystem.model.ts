import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface IAdminSystem extends Document {
    _id: Types.ObjectId
    key: 'system'
    bootstrapConsumedAt: Date | null
}

/** One document. Its only job is to remember that the first-owner bootstrap has been used. */
const AdminSystemSchema = new Schema<IAdminSystem>({
    key: { type: String, enum: ['system'], required: true, unique: true },
    bootstrapConsumedAt: { type: Date, default: null },
})

const AdminSystem: Model<IAdminSystem> = mongoose.model<IAdminSystem>('AdminSystem', AdminSystemSchema)
export default AdminSystem
