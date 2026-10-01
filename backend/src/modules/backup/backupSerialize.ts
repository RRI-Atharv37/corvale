import { Types } from 'mongoose'

const OBJECT_ID_ARRAY_FIELDS = new Set(['accountIds', 'receiptIds'])

const toIdString = (value: unknown): string | null => {
    if (value == null) {
        return null
    }
    if (value instanceof Types.ObjectId) {
        return value.toString()
    }
    if (typeof value === 'object' && value !== null && '_id' in value) {
        const nested = (value as { _id?: unknown })._id
        return nested instanceof Types.ObjectId ? nested.toString() : String(nested)
    }
    return String(value)
}

export const serializeDoc = (doc: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { id: toIdString(doc._id) }

    for (const [key, value] of Object.entries(doc)) {
        if (key === '_id' || key === '__v' || key === 'userId') {
            continue
        }

        if (value instanceof Types.ObjectId) {
            result[key] = value.toString()
            continue
        }

        if (value instanceof Date) {
            result[key] = value.toISOString()
            continue
        }

        if (Array.isArray(value)) {
            if (OBJECT_ID_ARRAY_FIELDS.has(key)) {
                result[key] = value.map((item) => toIdString(item))
                continue
            }
            result[key] = value
            continue
        }

        if (value && typeof value === 'object' && !(value instanceof Date)) {
            result[key] = serializeNested(value as Record<string, unknown>)
            continue
        }

        result[key] = value
    }

    return result
}

const serializeNested = (value: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
        if (nestedValue instanceof Date) {
            result[key] = nestedValue.toISOString()
        } else if (nestedValue instanceof Types.ObjectId) {
            result[key] = nestedValue.toString()
        } else {
            result[key] = nestedValue
        }
    }
    return result
}
