import mongoose, { Document, Model, Schema, Types } from 'mongoose'

export const JOB_NAMES = ['sweep:billing', 'reconcile:billing'] as const
export type JobName = (typeof JOB_NAMES)[number]

export const JOB_RUN_RETENTION_DAYS = 90

export interface IJobRun extends Document {
    _id: Types.ObjectId
    name: JobName
    startedAt: Date
    finishedAt: Date | null
    ok: boolean
    exitCode: number | null
    counts: Record<string, number>
    error: string | null
}

const JobRunSchema = new Schema<IJobRun>(
    {
        name: { type: String, enum: JOB_NAMES, required: true },
        startedAt: { type: Date, required: true },
        finishedAt: { type: Date, default: null },
        ok: { type: Boolean, default: false },
        exitCode: { type: Number, default: null },
        counts: { type: Schema.Types.Mixed, default: {} },
        error: { type: String, default: null },
    },
    { minimize: false }
)

JobRunSchema.index({ name: 1, startedAt: -1 })
JobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: JOB_RUN_RETENTION_DAYS * 24 * 60 * 60 })

// System collection: no userId, so row-level security does not apply. Holds counters only, never ids or addresses.
const JobRun: Model<IJobRun> = mongoose.model<IJobRun>('JobRun', JobRunSchema)
export default JobRun
