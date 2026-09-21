import React from 'react'

import ExternalLink from '@ui/ExternalLink'
import { formatDate, formatUsd } from '../billingFormat'
import type { Invoice, InvoiceStatus } from '../types'

interface InvoiceHistoryProps {
    invoices: Invoice[] | null
    loading: boolean
    error: string | null
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
    paid: 'Paid',
    pending: 'Pending',
    void: 'Void',
    refunded: 'Refunded',
}

const formatAmount = (invoice: Invoice): string =>
    invoice.currency === 'USD' ? formatUsd(invoice.total) : `${(invoice.total / 100).toFixed(2)} ${invoice.currency}`

const InvoiceHistory: React.FC<InvoiceHistoryProps> = ({ invoices, loading, error }) => (
    <section aria-labelledby="invoice-history-heading" className="glass-card card rounded-xl">
        <h2 id="invoice-history-heading" className="font-display text-lg font-semibold text-text-primary">
            Invoice history
        </h2>

        {loading && <p className="mt-3 text-sm text-text-muted">Loading invoices…</p>}
        {!loading && error && (
            <p className="mt-3 text-sm text-text-muted">
                We could not load your invoices right now. Your payment portal has the full history.
            </p>
        )}
        {!loading && !error && (!invoices || invoices.length === 0) && (
            <p className="mt-3 text-sm text-text-muted">No invoices yet. They appear here after your first payment.</p>
        )}

        {!loading && !error && invoices && invoices.length > 0 && (
            <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <caption className="sr-only">Invoices, newest first</caption>
                    <thead className="text-xs uppercase tracking-wide text-text-muted">
                        <tr>
                            <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                            <th scope="col" className="py-2 pr-4 font-medium">Amount</th>
                            <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                            <th scope="col" className="py-2 font-medium">
                                <span className="sr-only">Invoice</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {invoices.map((invoice) => (
                            <tr key={invoice.id}>
                                <td className="py-2 pr-4 text-text-secondary">{formatDate(invoice.issuedAt)}</td>
                                <td className="py-2 pr-4 text-text-primary">{formatAmount(invoice)}</td>
                                <td className="py-2 pr-4 text-text-secondary">{STATUS_LABEL[invoice.status]}</td>
                                <td className="py-2 text-right">
                                    {invoice.url ? (
                                        <ExternalLink href={invoice.url} className="text-accent hover:underline">
                                            View
                                        </ExternalLink>
                                    ) : (
                                        <span className="text-text-quiet">-</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </section>
)

export default InvoiceHistory
