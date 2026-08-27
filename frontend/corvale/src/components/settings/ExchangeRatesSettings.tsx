import React, { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { IoAdd, IoPencil, IoTrash } from 'react-icons/io5'

import axiosInstance from '../../utils/axiosInstance'
import { API_PATHS } from '../../utils/apiPaths'
import { useAsyncData } from '../../hooks/useAsyncData'
import type { ApiResponse, ExchangeRateMap } from '../../types/api'
import { unwrapApiData } from '../../utils/apiHelpers'
import { getApiErrorMessage } from '../../utils/apiError'
import { CURRENCY_OPTIONS, DEFAULT_CURRENCY } from '../../utils/currencies'
import { notifyExchangeRatesChanged } from '../../utils/format'
import { useUser } from '../../hooks/useUser'
import CurrencySelect from '../Inputs/CurrencySelect'
import FormField from '../forms/FormField'

const splitPair = (pair: string): { from: string; to: string } => {
    const [from, to] = pair.split('_')
    return { from: from ?? '', to: to ?? '' }
}

const ExchangeRatesSettings: React.FC = () => {
    const { restoreSession } = useUser()
    const [formOpen, setFormOpen] = useState(false)
    const [fromCurrency, setFromCurrency] = useState<string>(CURRENCY_OPTIONS[0]?.value ?? DEFAULT_CURRENCY)
    const [toCurrency, setToCurrency] = useState<string>(CURRENCY_OPTIONS[1]?.value ?? DEFAULT_CURRENCY)
    const [rateInput, setRateInput] = useState('')
    const [editingPair, setEditingPair] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [deletingPair, setDeletingPair] = useState<string | null>(null)

    const fetchRates = useCallback(async (): Promise<ExchangeRateMap> => {
        const response = await axiosInstance.get<ApiResponse<ExchangeRateMap>>(
            API_PATHS.EXCHANGE_RATES.GET_ALL
        )
        return unwrapApiData(response)
    }, [])

    const { data: rates, loading, error, refetch } = useAsyncData(fetchRates, [fetchRates])

    const openCreate = () => {
        setEditingPair(null)
        setFromCurrency(CURRENCY_OPTIONS[0]?.value ?? DEFAULT_CURRENCY)
        setToCurrency(CURRENCY_OPTIONS[1]?.value ?? DEFAULT_CURRENCY)
        setRateInput('')
        setFormOpen(true)
    }

    const openEdit = (pair: string, rate: number) => {
        const { from, to } = splitPair(pair)
        setEditingPair(pair)
        setFromCurrency(from)
        setToCurrency(to)
        setRateInput(String(rate))
        setFormOpen(true)
    }

    const closeForm = () => {
        setFormOpen(false)
        setEditingPair(null)
        setRateInput('')
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        const rate = Number(rateInput)
        if (!rateInput.trim() || isNaN(rate) || rate <= 0) {
            toast.error('Rate must be a positive number')
            return
        }

        if (!editingPair && fromCurrency === toCurrency) {
            toast.error('From and to currencies must be different')
            return
        }

        setSubmitting(true)
        try {
            if (editingPair) {
                await axiosInstance.patch(API_PATHS.EXCHANGE_RATES.UPDATE(editingPair), { rate })
                toast.success('Exchange rate updated')
            } else {
                await axiosInstance.post(API_PATHS.EXCHANGE_RATES.CREATE, {
                    pair: `${fromCurrency}/${toCurrency}`,
                    rate,
                })
                toast.success('Exchange rate saved')
            }
            closeForm()
            await refetch()
            await restoreSession()
            notifyExchangeRatesChanged()
        } catch (submitError) {
            toast.error(getApiErrorMessage(submitError, 'Failed to save exchange rate'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (pair: string) => {
        setDeletingPair(pair)
        try {
            await axiosInstance.delete(API_PATHS.EXCHANGE_RATES.DELETE(pair))
            toast.success('Exchange rate removed')
            await refetch()
            await restoreSession()
            notifyExchangeRatesChanged()
        } catch (deleteError) {
            toast.error(getApiErrorMessage(deleteError, 'Failed to remove exchange rate'))
        } finally {
            setDeletingPair(null)
        }
    }

    const entries = Object.entries(rates ?? {})

    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="section-label">Exchange rates</p>
                <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 transition-colors"
                >
                    <IoAdd size={14} />
                    Add
                </button>
            </div>

            <p className="text-xs text-text-muted mb-3">
                Set manual conversion rates so accounts and net worth can be shown in your default
                currency alongside their original currency.
            </p>

            {loading ? (
                <p className="text-sm text-text-muted">Loading exchange rates...</p>
            ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
            ) : entries.length === 0 ? (
                <p className="text-sm text-text-muted">No exchange rates configured yet.</p>
            ) : (
                <ul className="space-y-2">
                    {entries.map(([pair, rate]) => {
                        const { from, to } = splitPair(pair)
                        return (
                            <li
                                key={pair}
                                className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2"
                            >
                                <p className="text-sm text-text-primary">
                                    1 {from} = {rate} {to}
                                </p>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => openEdit(pair, rate)}
                                        className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-accent-subtle transition-colors"
                                        aria-label={`Edit ${from} to ${to} rate`}
                                    >
                                        <IoPencil size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleDelete(pair)}
                                        disabled={deletingPair === pair}
                                        className="p-1.5 rounded-md text-text-muted hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                                        aria-label={`Delete ${from} to ${to} rate`}
                                    >
                                        <IoTrash size={14} />
                                    </button>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            {formOpen && (
                <form
                    onSubmit={(event) => void handleSubmit(event)}
                    className="mt-3 space-y-3 rounded-lg border border-border-subtle p-3"
                >
                    <div className="grid grid-cols-2 gap-3">
                        <CurrencySelect
                            label="From"
                            value={fromCurrency}
                            onChange={setFromCurrency}
                            disabled={submitting || editingPair !== null}
                        />
                        <CurrencySelect
                            label="To"
                            value={toCurrency}
                            onChange={setToCurrency}
                            disabled={submitting || editingPair !== null}
                        />
                    </div>
                    <FormField
                        label={`1 ${fromCurrency} equals`}
                        type="number"
                        value={rateInput}
                        onChange={setRateInput}
                        placeholder="1.10"
                        step="0.0001"
                        min="0"
                        required
                        disabled={submitting}
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={closeForm}
                            disabled={submitting}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg btn-accent transition-colors disabled:opacity-60"
                        >
                            {submitting ? 'Saving...' : editingPair ? 'Save changes' : 'Add rate'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    )
}

export default ExchangeRatesSettings
