import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export interface ICategory extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId | null
    masterCategoryId: Types.ObjectId | null
    name: string
    icon?: string
    color?: string
    isDefault: boolean
    isArchived: boolean
    sortOrder: number
}

const CategorySchema = new Schema<ICategory>(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        masterCategoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
        },
        name: { type: String, required: true, trim: true },
        icon: { type: String, trim: true },
        color: { type: String, trim: true },
        isDefault: { type: Boolean, default: false },
        isArchived: { type: Boolean, default: false },
        sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true }
)

CategorySchema.index({ userId: 1, isArchived: 1, sortOrder: 1 })
CategorySchema.index(
    { userId: 1, isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true, isArchived: false, userId: { $type: 'objectId' } } }
)
CategorySchema.index(
    { userId: 1, masterCategoryId: 1, name: 1 },
    { unique: true, partialFilterExpression: { isArchived: false, userId: { $type: 'objectId' } } }
)
CategorySchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { userId: null } })
CategorySchema.index({ userId: 1, updatedAt: 1, _id: 1 })

const Category: Model<ICategory> = mongoose.model<ICategory>('Category', CategorySchema)
export default Category
