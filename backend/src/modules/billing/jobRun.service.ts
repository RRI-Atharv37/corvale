import { JOB_NAMES, type JobName, type IJobRun } from './jobRun.model'
import JobRun from './jobRun.model'

export { JobRun }

const MAX_ERROR_LENGTH = 200

export interface JobOutcome {
    counts?: Record<string, number>
    exitCode?: number
}

/** Only whole, finite numbers survive: a run record can never smuggle an id, an address or a nested object. */
const wholeNumbersOnly = (counts: Record<string, unknown> | undefined): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(counts ?? {})) {
        if (typeof value === 'number' && Number.isInteger(value)) out[key] = value
    }
    return out
}

/**
 * Leaves a trace of one scheduled run. Nothing schedules the sweeps yet, so the ops panel needs to see when
 * nothing ran at all; a job that throws is recorded as failed and the error still propagates.
 */
export const withJobRun = async <T extends JobOutcome>(name: JobName, job: () => Promise<T>): Promise<T> => {
    if (!(JOB_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown job: ${name}`)

    const run = await JobRun.create({ name, startedAt: new Date() })
    try {
        const outcome = await job()
        const exitCode = outcome.exitCode ?? 0
        await JobRun.updateOne(
            { _id: run._id },
            { $set: { finishedAt: new Date(), ok: exitCode === 0, exitCode, counts: wholeNumbersOnly(outcome.counts) } }
        )
        return outcome
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown'
        await JobRun.updateOne(
            { _id: run._id },
            { $set: { finishedAt: new Date(), ok: false, exitCode: 1, error: message.slice(0, MAX_ERROR_LENGTH) } }
        )
        throw error
    }
}

export const getLatestJobRun = async (name: JobName): Promise<IJobRun | null> =>
    JobRun.findOne({ name }).sort({ startedAt: -1, _id: -1 }).lean<IJobRun>()
