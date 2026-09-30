type Stamp = Date | string | number

export type TransferRole = 'out' | 'in'

export const isTransferRole = (value: unknown): value is TransferRole =>
    value === 'out' || value === 'in'

interface TransferLegStamp {
    id: string
    createdAt: Stamp
    transferRole?: TransferRole | null
}

const toMillis = (value: Stamp): number =>
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)

/**
 * Each leg stores its own `transferRole`; that is the source of truth. A leg without one (written
 * before the field existed and not yet backfilled) falls back to its pair's role, then to creation
 * order: the later-created leg is inbound, and two legs in the same millisecond tie on id so that
 * exactly one leg reads as inbound.
 */
export const isInboundTransferLeg = (own: TransferLegStamp, pair: TransferLegStamp): boolean => {
    if (own.transferRole) {
        return own.transferRole === 'in'
    }
    if (pair.transferRole) {
        return pair.transferRole === 'out'
    }
    const difference = toMillis(own.createdAt) - toMillis(pair.createdAt)
    if (difference !== 0 && !Number.isNaN(difference)) {
        return difference > 0
    }
    return own.id > pair.id
}
