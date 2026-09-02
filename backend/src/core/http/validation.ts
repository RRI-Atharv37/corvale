import { CustomError } from '../errors/customError'

export const validateRequiredFields = (
    fields: Record<string, unknown>,
    requiredFields: string[]
): void => {
    const missingFields = requiredFields.filter((field) => {
        const value = fields[field]
        return value === undefined || value === null || value === ''
    })
    if (missingFields.length > 0) {
        throw new CustomError(`Missing required fields: ${missingFields.join(', ')}`, 400)
    }
}
