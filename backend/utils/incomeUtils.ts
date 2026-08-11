import Income from '../models/Income'
import { toObjectId } from './sharedUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
} from './sharedUtils'

export const aggregateIncomes = async (userId: string, groupBy: string) => {
    return Income.aggregate([
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
