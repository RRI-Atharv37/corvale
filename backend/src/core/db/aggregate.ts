import { Model, Types } from 'mongoose'
import { toObjectId } from './objectId'

export const aggregateByField = async <T extends { userId: Types.ObjectId }>(
    model: Model<T>,
    userId: string,
    groupBy: string
) => {
    return model.aggregate([
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
