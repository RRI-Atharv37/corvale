import Expense from '../models/Expense'
import { aggregateByField } from './sharedUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
    aggregateByField,
} from './sharedUtils'

export const aggregateExpenses = async (userId: string, groupBy: string) => {
    return aggregateByField(Expense, userId, groupBy)
}
