import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { IUser, User } from '@modules/users'
import { ACCOUNT_TYPES } from '@modules/accounts'
import { createAccount } from '@modules/accounts/account.service'
import { Budget } from '@modules/budgets'
import { SavingsGoal } from '@modules/savings-goals'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DEFAULT_CURRENCY, parseOptionalSupportedCurrency } from '@core/money/currencyUtils'
import { parseOpeningBalanceMajor } from '@core/money/moneyUtils'
import { parseGoalAmount } from '@modules/savings-goals/savingsGoalUtils'
import { isObjectIdString } from '@core/db/objectId'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import {
    ONBOARDING_STEPS,
    OnboardingStep,
    calculateOnboardingProgress,
    isOnboardingStep,
    nextOnboardingStep,
} from './onboardingUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'
import { parseBudgetAmount, resolveMonthlyPeriod, validateCategoryForBudget } from "@modules/budgets/budgetUtils";

const loadUser = async (userId: string): Promise<IUser> => {
    const user = await User.findById(userId)
    if (!user) {
        throw new CustomError(ERROR_MESSAGES.USER.USER_NOT_FOUND, 404)
    }
    return user
}

const requireOnboardingStarted = (user: IUser): void => {
    if (!user.onboardingStarted) {
        throw new CustomError(ERROR_MESSAGES.ONBOARDING.NOT_STARTED, 404)
    }
}

const serializeOnboardingStatus = (user: IUser) => ({
    currentStep: user.onboardingCurrentStep ?? null,
    onboardingCompleted: user.onboardingCompleted,
    onboardingSkipped: user.onboardingSkipped,
    progressPercentage: calculateOnboardingProgress(user.onboardingStepsCompleted),
    stepsCompleted: user.onboardingStepsCompleted,
})

/**
 * The opening balance a user enters during onboarding is "what's in the account
 * right now", so it is stated as of *today* by default (start of day, UTC):
 * transactions they later add or import that predate today don't distort the
 * figure they just gave us. An explicit `openingBalanceDate` overrides this
 * (e.g. importing full history from the account's real start).
 */
const parseOnboardingOpeningBalanceDate = (value: unknown): Date => {
    if (value === undefined || value === null || value === '') {
        const now = new Date()
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    }
    const parsed = new Date(value as string | number)
    if (isNaN(parsed.getTime())) {
        throw new CustomError('Invalid opening balance date', 400)
    }
    return parsed
}

const createOnboardingAccount = async (
    userId: string,
    currency: string,
    body: Record<string, unknown>
) => {
    validateRequiredFields(body, ['accountName', 'accountType'])

    const { accountName, accountType, openingBalance } = body
    if (!ACCOUNT_TYPES.includes(accountType as (typeof ACCOUNT_TYPES)[number])) {
        throw new CustomError(`Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(', ')}`, 400)
    }

    if (typeof accountName !== 'string' || accountName.trim() === '') {
        throw new CustomError('Account name must be text', 400)
    }

    return createAccount({
        userId,
        workspaceId: null,
        name: accountName.trim(),
        type: accountType as (typeof ACCOUNT_TYPES)[number],
        currency: parseOptionalSupportedCurrency(currency),
        openingBalance: parseOpeningBalanceMajor(openingBalance),
        openingBalanceDate: parseOnboardingOpeningBalanceDate(body.openingBalanceDate),
        isDefault: false,
        clientId: null,
    })
}

const createOnboardingBudget = async (
    userId: string,
    currency: string,
    timezone: string,
    body: Record<string, unknown>
) => {
    validateRequiredFields(body, ['budgetName', 'budgetAmount'])

    const amount = parseBudgetAmount(body.budgetAmount)

    let categoryId: Types.ObjectId | null = null
    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '') {
        if (!isObjectIdString(body.categoryId)) {
            throw new CustomError(ERROR_MESSAGES.CATEGORY.INVALID_CATEGORY_ID, 400)
        }
        const category = await validateCategoryForBudget(body.categoryId, userId)
        categoryId = category._id
    }

    const now = new Date()
    const { periodStart, periodEnd } = resolveMonthlyPeriod(
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        timezone
    )

    return Budget.create({
        userId,
        workspaceId: null,
        name: String(body.budgetName).trim(),
        periodType: 'monthly',
        periodStart,
        periodEnd,
        categoryId,
        amount,
        currency: parseOptionalSupportedCurrency(currency),
    })
}

const createOnboardingGoal = async (userId: string, currency: string, body: Record<string, unknown>) => {
    validateRequiredFields(body, ['goalName', 'targetAmount'])

    const targetAmount = parseGoalAmount(body.targetAmount)

    return SavingsGoal.create({
        userId,
        workspaceId: null,
        name: String(body.goalName).trim(),
        targetAmount,
        currency: parseOptionalSupportedCurrency(currency),
    })
}

export const startOnboarding = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const user = await loadUser(userId)

    if (!user.onboardingStarted) {
        user.onboardingStarted = true
        user.onboardingCompleted = false
        user.onboardingSkipped = false
        user.onboardingCurrentStep = ONBOARDING_STEPS[0]
        user.onboardingStepsCompleted = []
        await user.save()
    }

    handleResponses(res, 200, serializeOnboardingStatus(user))
})

export const getOnboardingStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const user = await loadUser(userId)

    requireOnboardingStarted(user)

    handleResponses(res, 200, serializeOnboardingStatus(user))
})

export const advanceOnboardingStep = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { step } = req.params

    if (!isOnboardingStep(step)) {
        throw new CustomError(ERROR_MESSAGES.ONBOARDING.INVALID_STEP, 400)
    }

    const user = await loadUser(userId)
    requireOnboardingStarted(user)

    if (user.onboardingCurrentStep !== step) {
        throw new CustomError(ERROR_MESSAGES.ONBOARDING.INVALID_STEP_ORDER, 400)
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const extra: Record<string, unknown> = {}
    const currentStep: OnboardingStep = step
    const currency = user.preferredCurrency || DEFAULT_CURRENCY

    if (currentStep === 'account') {
        const account = await createOnboardingAccount(userId, currency, body)
        extra.accountCreated = true
        extra.accountId = account._id
    } else if (currentStep === 'categories') {
        extra.categoriesReviewed = Boolean(body.categoriesReviewed)
    } else if (currentStep === 'budget') {
        if (body.skipped) {
            extra.budgetCreated = false
        } else {
            const budget = await createOnboardingBudget(
                userId,
                currency,
                user.timezone || DEFAULT_TIMEZONE,
                body
            )
            extra.budgetCreated = true
            extra.budgetId = budget._id
        }
    } else if (currentStep === 'goal') {
        if (body.skipped) {
            extra.goalCreated = false
        } else {
            const goal = await createOnboardingGoal(userId, currency, body)
            extra.goalCreated = true
            extra.goalId = goal._id
        }
    } else if (currentStep === 'tour') {
        extra.tourCompleted = Boolean(body.tourCompleted)
    }

    if (!user.onboardingStepsCompleted.includes(currentStep)) {
        user.onboardingStepsCompleted.push(currentStep)
    }

    const next = nextOnboardingStep(currentStep)
    if (next) {
        user.onboardingCurrentStep = next
    } else {
        user.onboardingCurrentStep = null
        user.onboardingCompleted = true
    }

    await user.save()

    handleResponses(res, 200, { ...serializeOnboardingStatus(user), ...extra })
})

export const skipOnboarding = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const user = await loadUser(userId)

    requireOnboardingStarted(user)

    user.onboardingCompleted = true
    user.onboardingSkipped = true
    user.onboardingCurrentStep = null
    await user.save()

    handleResponses(res, 200, serializeOnboardingStatus(user))
})

export const replayOnboarding = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const user = await loadUser(userId)

    user.onboardingStarted = true
    user.onboardingCompleted = false
    user.onboardingSkipped = false
    user.onboardingCurrentStep = ONBOARDING_STEPS[0]
    user.onboardingStepsCompleted = []
    await user.save()

    handleResponses(res, 200, serializeOnboardingStatus(user))
})
