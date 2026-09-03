import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'

import Modal from '@ui/Modal'
import FormField from '@ui/forms/FormField'
import axiosInstance from '@lib/axiosInstance'
import { API_PATHS } from '@lib/apiPaths'
import { unwrapApiData } from '@lib/apiHelpers'
import { getApiErrorMessage } from '@lib/apiError'
import { BRAND } from '@lib/brand'
import type {
    AccountType,
    ApiResponse,
    CategoriesResponse,
    OnboardingStatus,
    OnboardingStep,
} from '@lib/types/api'

export interface OnboardingWizardHandle {
    replay: () => void
}

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
    { value: 'checking', label: 'Checking' },
    { value: 'cash', label: 'Cash' },
    { value: 'credit', label: 'Credit' },
    { value: 'savings', label: 'Savings' },
]

const STEP_LABELS: Record<OnboardingStep, string> = {
    account: 'Add your first account',
    categories: 'Review categories',
    budget: 'Set a budget',
    goal: 'Set a savings goal',
    tour: 'Quick tour',
}

const OnboardingWizard = forwardRef<OnboardingWizardHandle>((_props, ref) => {
    const [visible, setVisible] = useState(false)
    const [status, setStatus] = useState<OnboardingStatus | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [skipping, setSkipping] = useState(false)
    const [checked, setChecked] = useState(false)
    const [categories, setCategories] = useState<CategoriesResponse | null>(null)

    const [accountName, setAccountName] = useState('')
    const [accountType, setAccountType] = useState<AccountType>('checking')
    const [openingBalance, setOpeningBalance] = useState('0')
    const [openingBalanceDate, setOpeningBalanceDate] = useState(() =>
        new Date().toISOString().slice(0, 10)
    )

    const [budgetName, setBudgetName] = useState('Monthly Budget')
    const [budgetAmount, setBudgetAmount] = useState('')
    const [budgetCategoryId, setBudgetCategoryId] = useState('')

    const [goalName, setGoalName] = useState('Emergency Fund')
    const [targetAmount, setTargetAmount] = useState('')

    const resetStepForms = () => {
        setAccountName('')
        setAccountType('checking')
        setOpeningBalance('0')
        setBudgetName('Monthly Budget')
        setBudgetAmount('')
        setBudgetCategoryId('')
        setGoalName('Emergency Fund')
        setTargetAmount('')
    }

    const checkOnboarding = useCallback(async () => {
        try {
            const response = await axiosInstance.get<ApiResponse<OnboardingStatus>>(
                API_PATHS.ONBOARDING.STATUS
            )
            const data = unwrapApiData(response)
            if (!data.onboardingCompleted) {
                setStatus(data)
                setVisible(true)
            }
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                try {
                    const startResponse = await axiosInstance.post<ApiResponse<OnboardingStatus>>(
                        API_PATHS.ONBOARDING.START
                    )
                    setStatus(unwrapApiData(startResponse))
                    setVisible(true)
                } catch {
                    // Onboarding is a nicety, not a blocker — silently skip if it can't start
                }
            }
        }
    }, [])

    useEffect(() => {
        if (checked) return
        setChecked(true)
        void checkOnboarding()
    }, [checked, checkOnboarding])

    useEffect(() => {
        if (visible && status?.currentStep === 'budget' && !categories) {
            void (async () => {
                try {
                    const response = await axiosInstance.get<ApiResponse<CategoriesResponse>>(
                        API_PATHS.CATEGORIES.GET_ALL
                    )
                    setCategories(unwrapApiData(response))
                } catch {
                    // Category select is a nicety here; budget step still works without it
                }
            })()
        }
    }, [visible, status?.currentStep, categories])

    useImperativeHandle(ref, () => ({
        replay: () => {
            void (async () => {
                try {
                    const response = await axiosInstance.post<ApiResponse<OnboardingStatus>>(
                        API_PATHS.ONBOARDING.REPLAY
                    )
                    resetStepForms()
                    setStatus(unwrapApiData(response))
                    setVisible(true)
                } catch (error) {
                    toast.error(getApiErrorMessage(error, 'Failed to restart onboarding'))
                }
            })()
        },
    }))

    const close = () => setVisible(false)

    const submitStep = async (step: OnboardingStep, body: Record<string, unknown>) => {
        setSubmitting(true)
        try {
            const response = await axiosInstance.post<ApiResponse<OnboardingStatus>>(
                API_PATHS.ONBOARDING.STEP(step),
                body
            )
            const data = unwrapApiData(response)
            setStatus(data)
            if (data.onboardingCompleted) {
                toast.success(`Welcome to ${BRAND.name}! Your setup is complete.`)
                close()
            }
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to save this step'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleAccountSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!accountName.trim()) {
            toast.error('Account name is required')
            return
        }
        void submitStep('account', {
            accountName: accountName.trim(),
            accountType,
            openingBalance: openingBalance || '0',
            openingBalanceDate: openingBalanceDate || undefined,
        })
    }

    const handleCategoriesContinue = () => {
        void submitStep('categories', { categoriesReviewed: true })
    }

    const handleBudgetSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const amount = Number(budgetAmount)
        if (!budgetAmount || isNaN(amount) || amount <= 0) {
            toast.error('Enter a valid budget amount')
            return
        }
        void submitStep('budget', {
            budgetName: budgetName.trim() || 'Monthly Budget',
            budgetAmount: amount,
            categoryId: budgetCategoryId || undefined,
        })
    }

    const handleBudgetSkip = () => void submitStep('budget', { skipped: true })

    const handleGoalSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const amount = Number(targetAmount)
        if (!targetAmount || isNaN(amount) || amount <= 0) {
            toast.error('Enter a valid goal amount')
            return
        }
        void submitStep('goal', {
            goalName: goalName.trim() || 'Emergency Fund',
            targetAmount: amount,
        })
    }

    const handleGoalSkip = () => void submitStep('goal', { skipped: true })

    const handleTourFinish = () => void submitStep('tour', { tourCompleted: true })

    const handleSkipAll = async () => {
        setSkipping(true)
        try {
            await axiosInstance.patch(API_PATHS.ONBOARDING.SKIP)
            close()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Failed to skip onboarding'))
        } finally {
            setSkipping(false)
        }
    }

    if (!visible || !status || !status.currentStep) return null

    const categoryOptions = categories ? [...categories.masters, ...categories.userCategories] : []

    return (
        <Modal open={visible} onClose={close} title={`Welcome to ${BRAND.name}`} size="md">
            <div className="space-y-5">
                <div>
                    <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
                        <span>{STEP_LABELS[status.currentStep]}</span>
                        <span>{status.progressPercentage}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface overflow-hidden">
                        <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${status.progressPercentage}%` }}
                        />
                    </div>
                </div>

                {status.currentStep === 'account' && (
                    <form onSubmit={handleAccountSubmit} className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            Let&apos;s start with your first account so we can track balances and
                            transactions.
                        </p>
                        <FormField
                            label="Account name"
                            value={accountName}
                            onChange={setAccountName}
                            placeholder="e.g. Main Checking"
                            required
                        />
                        <div>
                            <label className="text-[13px] text-fg-secondary">
                                Account type<span className="text-expense ml-0.5">*</span>
                            </label>
                            <div className="input-box mb-0 mt-1">
                                <select
                                    value={accountType}
                                    onChange={(e) => setAccountType(e.target.value as AccountType)}
                                    className="w-full bg-transparent outline-none text-fg"
                                >
                                    {ACCOUNT_TYPE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value} className="bg-surface">
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <FormField
                            label="Current balance"
                            type="number"
                            value={openingBalance}
                            onChange={setOpeningBalance}
                            step="0.01"
                        />
                        <FormField
                            label="Balance as of"
                            type="date"
                            value={openingBalanceDate}
                            onChange={setOpeningBalanceDate}
                            max={new Date().toISOString().slice(0, 10)}
                        />
                        <p className="text-[12px] text-fg-muted -mt-2">
                            Enter what&apos;s in the account today. Transactions dated before this
                            date won&apos;t change the balance &mdash; so you can safely import or
                            back-fill older history later. Adjust the date if you&apos;re starting
                            from the account&apos;s very beginning.
                        </p>
                        <div className="flex justify-end gap-2 pt-2">
                            <button type="submit" disabled={submitting} className="btn-primary">
                                {submitting ? 'Saving...' : 'Continue'}
                            </button>
                        </div>
                    </form>
                )}

                {status.currentStep === 'categories' && (
                    <div className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            We&apos;ve pre-loaded a set of common categories for income and expenses. You
                            can customize them anytime from the Categories page.
                        </p>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleCategoriesContinue}
                                disabled={submitting}
                                className="btn-primary"
                            >
                                {submitting ? 'Saving...' : 'Continue'}
                            </button>
                        </div>
                    </div>
                )}

                {status.currentStep === 'budget' && (
                    <form onSubmit={handleBudgetSubmit} className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            Want to set a monthly budget? You can skip this and add one later.
                        </p>
                        <FormField
                            label="Budget name"
                            value={budgetName}
                            onChange={setBudgetName}
                            placeholder="Monthly Budget"
                        />
                        <FormField
                            label="Amount"
                            type="number"
                            value={budgetAmount}
                            onChange={setBudgetAmount}
                            step="0.01"
                            placeholder="e.g. 2000"
                        />
                        {categoryOptions.length > 0 && (
                            <div>
                                <label className="text-[13px] text-fg-secondary">Category (optional)</label>
                                <div className="input-box mb-0 mt-1">
                                    <select
                                        value={budgetCategoryId}
                                        onChange={(e) => setBudgetCategoryId(e.target.value)}
                                        className="w-full bg-transparent outline-none text-fg"
                                    >
                                        <option value="" className="bg-surface">
                                            Overall (all categories)
                                        </option>
                                        {categoryOptions.map((category) => (
                                            <option key={category._id} value={category._id} className="bg-surface">
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleBudgetSkip}
                                disabled={submitting}
                                className="btn-secondary"
                            >
                                Skip
                            </button>
                            <button type="submit" disabled={submitting} className="btn-primary">
                                {submitting ? 'Saving...' : 'Create budget'}
                            </button>
                        </div>
                    </form>
                )}

                {status.currentStep === 'goal' && (
                    <form onSubmit={handleGoalSubmit} className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            Want to set a savings goal? You can skip this and add one later.
                        </p>
                        <FormField
                            label="Goal name"
                            value={goalName}
                            onChange={setGoalName}
                            placeholder="Emergency Fund"
                        />
                        <FormField
                            label="Target amount"
                            type="number"
                            value={targetAmount}
                            onChange={setTargetAmount}
                            step="0.01"
                            placeholder="e.g. 10000"
                        />
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleGoalSkip}
                                disabled={submitting}
                                className="btn-secondary"
                            >
                                Skip
                            </button>
                            <button type="submit" disabled={submitting} className="btn-primary">
                                {submitting ? 'Saving...' : 'Create goal'}
                            </button>
                        </div>
                    </form>
                )}

                {status.currentStep === 'tour' && (
                    <div className="space-y-4">
                        <p className="text-sm text-fg-secondary">
                            You&apos;re all set! Add transactions from the Transactions page, track
                            spending on Reports, and explore Forecast, Calendar, and Debt Payoff for
                            deeper planning.
                        </p>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleTourFinish}
                                disabled={submitting}
                                className="btn-primary"
                            >
                                {submitting ? 'Finishing...' : 'Finish setup'}
                            </button>
                        </div>
                    </div>
                )}

                <div className="border-t border-border-subtle pt-3 text-center">
                    <button
                        type="button"
                        onClick={() => void handleSkipAll()}
                        disabled={skipping}
                        className="text-xs text-fg-muted hover:text-fg-secondary transition-colors"
                    >
                        {skipping ? 'Skipping...' : 'Skip onboarding'}
                    </button>
                </div>
            </div>
        </Modal>
    )
})

OnboardingWizard.displayName = 'OnboardingWizard'

export default OnboardingWizard
