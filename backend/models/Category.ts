import mongoose, { Document, Model, Schema, Types } from 'mongoose'

import { applyRowLevelSecurity } from '../utils/applyRowLevelSecurity'

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
    createdAt: Date
    updatedAt: Date
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

// Row-level security (SEC-30). Shared master categories are stored with `userId: null`; a
// `{ userId: null }` filter still satisfies the guard's `'userId' in filter` check, so master
// reads keep working. Call sites that need both a user's own categories and the shared masters
// pass `{ userId: { $in: [<userId>, null] } }`.
applyRowLevelSecurity(CategorySchema)

const Category: Model<ICategory> = mongoose.model<ICategory>('Category', CategorySchema)
export default Category
