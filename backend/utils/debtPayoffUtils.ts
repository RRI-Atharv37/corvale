import {
    generatePayoffSchedule as sharedGeneratePayoffSchedule,
    orderDebtsByAvalanche,
    orderDebtsBySnowball,
} from '../../shared/src/debtPayoff'
import type { DebtInput, DebtPayment, PayoffMonth, PayoffPlan, PayoffStrategy } from '../../shared/src/debtPayoff'
import { CustomError } from './customError'

export type { DebtInput, DebtPayment, PayoffMonth, PayoffPlan, PayoffStrategy }
export { orderDebtsByAvalanche, orderDebtsBySnowball }

/** Translates the shared engine's plain `Error` (unpayable debt) into a `CustomError(400)` to preserve existing API behavior. */
export const generatePayoffSchedule = (
    debts: DebtInput[],
    extraPaymentMinor: number,
    strategy: PayoffStrategy
): PayoffPlan => {
    try {
        return sharedGeneratePayoffSchedule(debts, extraPaymentMinor, strategy)
    } catch (err) {
        if (err instanceof CustomError) {
            throw err
        }
        if (err instanceof Error) {
            throw new CustomError(err.message, 400)
        }
        throw err
    }
}
