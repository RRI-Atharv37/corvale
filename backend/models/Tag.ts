import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface ITag extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    name: string
    color?: string
}

const TagSchema = new Schema<ITag>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        color: { type: String, trim: true },
    },
    { timestamps: true }
)

TagSchema.index({ userId: 1, name: 1 }, { unique: true })

const Tag: Model<ITag> = mongoose.model<ITag>('Tag', TagSchema)
export default Tag
