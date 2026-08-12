import mongoose, {Document, Model, Schema, Types } from 'mongoose'

export interface IExpense extends Document {
    userId: mongoose.Types.ObjectId
    title: string
    amount: number
    category: string
    description?: string
    date: Date
    paymentMethod?: string
    recurring?: string
    tags?: string[]
    createdAt: Date
    updatedAt: Date
}

const ExpenseSchema = new Schema<IExpense>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    description: { type: String, required: false },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, required: false },
    recurring: { type: String, required: false },
    tags: [{ type: String }],
}, { timestamps: true })

ExpenseSchema.index({ userId: 1, date: -1 })

const Expense: Model<IExpense> = mongoose.model<IExpense>('Expense', ExpenseSchema)
export default Expense