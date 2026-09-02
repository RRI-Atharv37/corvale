import Expense from '../models/Expense'
import { aggregateByField } from '@core/db/aggregate'

export const aggregateExpenses = async (userId: string, groupBy: string) => {
    return aggregateByField(Expense, userId, groupBy)
}

export { getUserId } from '@core/auth/requestUser'
export { handleResponses } from '@core/http/response'
export { validateOwnership } from '@core/access/ownership'
export { validateRequiredFields } from '@core/http/validation'
export { buildSearchRegex } from '@core/query/searchRegex'
export { aggregateByField } from '@core/db/aggregate'
