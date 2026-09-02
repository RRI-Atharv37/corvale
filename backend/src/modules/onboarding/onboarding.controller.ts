import asyncHandler from 'express-async-handler'
import { Response } from 'express'
import { Types } from 'mongoose'

import { IUser, User } from '@modules/users'
import { ACCOUNT_TYPES, Account } from '@modules/accounts'
import { Budget } from '@modules/budgets'
import { SavingsGoal } from '@modules/savings-goals'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DEFAULT_CURRENCY, parseOptionalSupportedCurrency } from '@core/money/currencyUtils'
import { parseAmountToMinorUnits } from '@core/money/moneyUtils'
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
import { resolveMonthlyPeriod } from "@modules/budgets/budgetUtils";
import { roundMoney } from "@shared/money";

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

    const parsedOpeningBalance = roundMoney(Number(openingBalance ?? 0))
    if (isNaN(parsedOpeningBalance)) {
        throw new CustomError('Invalid opening balance format', 400)
    }

    const parsedOpeningBalanceDate = parseOnboardingOpeningBalanceDate(body.openingBalanceDate)

    const existingCount = await Account.countDocuments({
        userId,
        workspaceId: null,
        isArchived: false,
    })

    return Account.create({
        userId,
        workspaceId: null,
        name: String(accountName).trim(),
        type: accountType,
        currency: parseOptionalSupportedCurrency(currency),
        openingBalance: parsedOpeningBalance,
        openingBalanceDate: parsedOpeningBalanceDate,
        currentBalance: parsedOpeningBalance,
        isDefault: existingCount === 0,
    })
}

const createOnboardingBudget = async (
    userId: string,
    currency: string,
    timezone: string,
    body: Record<string, unknown>
) => {
    validateRequiredFields(body, ['budgetName', 'budgetAmount'])

    const amount = parseAmountToMinorUnits(body.budgetAmount)
    if (amount <= 0) {
        throw new CustomError('Invalid budget amount; must be a positive number', 400)
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
        categoryId: body.categoryId ? new Types.ObjectId(String(body.categoryId)) : null,
        amount,
        currency: parseOptionalSupportedCurrency(currency),
    })
}

const createOnboardingGoal = async (userId: string, currency: string, body: Record<string, unknown>) => {
    validateRequiredFields(body, ['goalName', 'targetAmount'])

    const targetAmount = parseAmountToMinorUnits(body.targetAmount)
    if (targetAmount <= 0) {
        throw new CustomError('Invalid goal amount; must be a positive number', 400)
    }

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
