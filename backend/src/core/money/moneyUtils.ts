import { parseSignedMajorAmount, roundMoney } from '@shared/money'
import { CustomError } from '../errors/customError'

export {
    toMinorUnits,
    fromMinorUnits,
    parseAmountToMinorUnits,
    parseSignedMajorAmount,
    roundMoney,
    MAX_AMOUNT_MAJOR,
} from '@shared/money'

/** An account's opening balance in major units: signed, capped, absent meaning zero. */
export const parseOpeningBalanceMajor = (value: unknown): number => {
    if (value === undefined || value === null || value === '') {
        return 0
    }
    try {
        return roundMoney(parseSignedMajorAmount(value))
    } catch {
        throw new CustomError('Invalid opening balance format', 400)
    }
}

export const parseOptionalNonNegativeMajor = (value: unknown, fieldName: string): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    try {
        const parsed = parseSignedMajorAmount(value)
        if (parsed < 0) {
            throw new Error('negative')
        }
        return roundMoney(parsed)
    } catch {
        throw new CustomError(`Invalid ${fieldName}; must be a non-negative number`, 400)
    }
}
