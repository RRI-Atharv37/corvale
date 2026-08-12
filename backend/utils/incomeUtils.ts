import Income from '../models/Income'
import { aggregateByField } from './sharedUtils'

export {
    getUserId,
    handleResponses,
    validateOwnership,
    validateRequiredFields,
    buildSearchRegex,
    aggregateByField,
} from './sharedUtils'

export const aggregateIncomes = async (userId: string, groupBy: string) => {
    return aggregateByField(Income, userId, groupBy)
}
