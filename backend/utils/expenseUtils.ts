import Expense from '../models/Expense'
import { toObjectId } from './sharedUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
} from './sharedUtils'

export const aggregateExpenses = async (userId: string, groupBy: string) => {
    return Expense.aggregate([
        { $match: { userId: toObjectId(userId) } },
        {
            $group: {
                _id: `$${groupBy}`,
                totalAmount: { $sum: '$amount' },
            },
        },
        { $sort: { totalAmount: -1 } },
    ])
}
