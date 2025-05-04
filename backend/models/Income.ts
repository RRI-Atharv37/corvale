import mongoose, {Document, Model, Schema, Types } from 'mongoose'

export interface IIncome extends Document {
    _id: Types.ObjectId
    userId: Types.ObjectId
    icon: string
    title: string
    date: Date
    amount: number
    source?: string
    description?: string
    category?: string
}

const IncomeSchema = new Schema<IIncome>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    icon: { type: String, required: false },
    title: { type: String, required: true },
    date: { type: Date, default: Date.now },
    amount: { type: Number, required: true },
    source: { type: String, required: false},
    description: { type: String, required: false },
    category: { type: String, required: false },
}, { timestamps: true })

const Income: Model<IIncome> = mongoose.model<IIncome>('Income', IncomeSchema)
export default Income