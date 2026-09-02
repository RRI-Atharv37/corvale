import { ITransactionTemplate, TransactionTemplateType } from '../models/TransactionTemplate'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { fromMinorUnits } from '@core/money/moneyUtils'
import { normalizeTagName } from './tagUtils'
import { parseClientAmount, validateAccountForTransaction, validateCategoryForTransaction } from './transactionUtils'

export const parseTemplateType = (value: unknown): TransactionTemplateType => {
    const type = String(value ?? '').trim()
    if (type !== 'income' && type !== 'expense') {
        throw new CustomError(ERROR_MESSAGES.TRANSACTION_TEMPLATE.UNSUPPORTED_TYPE, 400)
    }
    return type
}

export const parseTemplateTags = (tags: unknown): string[] | undefined => {
    if (tags === undefined || tags === null) {
        return undefined
    }
    if (!Array.isArray(tags)) {
        throw new CustomError('Template tags must be an array', 400)
    }
    const normalized = [
        ...new Set(tags.map((tag) => normalizeTagName(String(tag))).filter(Boolean)),
    ]
    return normalized.length > 0 ? normalized : undefined
}

export const validateTemplateReferences = async (
    userId: string,
    accountId: string,
    categoryId: string
): Promise<void> => {
    await validateAccountForTransaction(accountId, userId)
    await validateCategoryForTransaction(categoryId, userId)
}

export const serializeTransactionTemplate = (template: ITransactionTemplate) => ({
    _id: template._id.toString(),
    userId: template.userId.toString(),
    name: template.name,
    type: template.type,
    amount: fromMinorUnits(template.amount),
    accountId: template.accountId.toString(),
    categoryId: template.categoryId.toString(),
    tags: template.tags ?? [],
    description: template.description,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
})

export const parseTemplateAmount = (value: unknown): number => {
    const amountMinor = parseClientAmount(value)
    if (amountMinor < 1) {
        throw new CustomError('Template amount must be greater than zero', 400)
    }
    return amountMinor
}
