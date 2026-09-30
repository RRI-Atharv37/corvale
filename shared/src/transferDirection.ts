type Stamp = Date | string | number

interface TransferLegStamp {
    id: string
    createdAt: Stamp
}

const toMillis = (value: Stamp): number =>
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)

/**
 * A transfer stores no direction: the later-created leg is the inbound one. Two legs written in the
 * same millisecond tie, and the id decides so that exactly one leg reads as inbound.
 */
export const isInboundTransferLeg = (own: TransferLegStamp, pair: TransferLegStamp): boolean => {
    const difference = toMillis(own.createdAt) - toMillis(pair.createdAt)
    if (difference !== 0 && !Number.isNaN(difference)) {
        return difference > 0
    }
    return own.id > pair.id
}
