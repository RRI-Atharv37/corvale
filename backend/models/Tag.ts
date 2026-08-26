import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applySoftDelete } from '../utils/applySoftDelete'

export interface ITag extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    name: string
    color?: string
    deletedAt?: Date | null
    createdAt: Date
    updatedAt: Date
}

const TagSchema = new Schema<ITag>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true, trim: true },
        color: { type: String, trim: true },
    },
    { timestamps: true }
)

TagSchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } })
TagSchema.index({ userId: 1, updatedAt: 1, _id: 1 })

applySoftDelete(TagSchema)

const Tag: Model<ITag> = mongoose.model<ITag>('Tag', TagSchema)
export default Tag
