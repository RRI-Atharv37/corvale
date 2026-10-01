import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IErasureLedger extends Document {
    idHash: string
    erasedAt: Date
    expiresAt: Date
}

// No userId by design: the row is a keyed hash and a date, so it cannot be read back to a person and
// the RLS plugin (which scopes by userId) does not apply.
const ErasureLedgerSchema = new Schema<IErasureLedger>({
    idHash: { type: String, required: true, unique: true },
    erasedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
})

ErasureLedgerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const ErasureLedger: Model<IErasureLedger> = mongoose.model<IErasureLedger>('ErasureLedger', ErasureLedgerSchema)
export default ErasureLedger
