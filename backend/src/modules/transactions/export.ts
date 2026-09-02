import PDFDocument from 'pdfkit'
import { Response } from 'express'

import { CustomError } from '@core/errors/customError'
import {
    buildCsvRow,
    buildCsvString,
    CSV_HEADERS,
    formatTransactionCsvRow,
    SerializedTransaction,
} from './transactionUtils'
import type { CustomReportResult } from "@modules/reports/reportUtils";
import { customReportToCsv, flattenCustomReport } from "@modules/reports/reportUtils";

export const EXPORT_FORMATS = ['csv', 'json', 'pdf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const TRANSACTION_EXPORT_TYPES = ['income', 'expense', 'both'] as const
export type TransactionExportType = (typeof TRANSACTION_EXPORT_TYPES)[number]

export interface TransactionExportRecord {
    type: string
    title: string
    amount: number
    currency: string
    category: string
    date: string
    description: string
    source: string
    paymentMethod: string
    tags: string
    status: string
}

export interface TransactionExportPayload {
    exportedAt: string
    filters: {
        type?: string
        startDate?: string
        endDate?: string
    }
    count: number
    transactions: TransactionExportRecord[]
}

export const parseExportFormat = (value: unknown): ExportFormat => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new CustomError(`Invalid export format. Must be one of: ${EXPORT_FORMATS.join(', ')}`, 400)
    }

    const normalized = value.trim().toLowerCase()
    if (!EXPORT_FORMATS.includes(normalized as ExportFormat)) {
        throw new CustomError(`Invalid export format. Must be one of: ${EXPORT_FORMATS.join(', ')}`, 400)
    }

    return normalized as ExportFormat
}

export const parseTransactionExportType = (value: unknown): TransactionExportType | undefined => {
    if (value === undefined || value === null || value === '') {
        return undefined
    }

    if (typeof value !== 'string') {
        throw new CustomError(
            `Invalid type filter. Must be one of: ${TRANSACTION_EXPORT_TYPES.join(', ')}`,
            400
        )
    }

    const normalized = value.trim().toLowerCase()
    if (!TRANSACTION_EXPORT_TYPES.includes(normalized as TransactionExportType)) {
        return undefined
    }

    return normalized as TransactionExportType
}

const sanitizeFilename = (filename: string): string => filename.replace(/[^\w.-]+/g, '_')

export const sendExportResponse = (
    res: Response,
    format: ExportFormat,
    filename: string,
    payload: {
        csvContent?: string
        jsonContent?: unknown
        renderPdf?: (doc: InstanceType<typeof PDFDocument>) => void
    }
): void => {
    const safeName = sanitizeFilename(filename)

    switch (format) {
        case 'csv':
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`)
            res.status(200).send(payload.csvContent ?? '')
            return
        case 'json':
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`)
            res.status(200).send(JSON.stringify(payload.jsonContent ?? {}, null, 2))
            return
        case 'pdf': {
            res.setHeader('Content-Type', 'application/pdf')
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`)
            const doc = new PDFDocument({ margin: 50, size: 'A4' })
            doc.pipe(res)
            payload.renderPdf?.(doc)
            doc.end()
            return
        }
        default:
            throw new CustomError(`Unsupported export format: ${format}`, 400)
    }
}

/**
 * Streams a CSV export row-by-row instead of buffering the full file in memory, so a large date
 * range doesn't hold every matching transaction (and the whole rendered CSV string) in the
 * process at once. `rows` is expected to be backed by a DB cursor rather than a pre-loaded array.
 */
export const streamCsvExport = async (
    res: Response,
    filename: string,
    headerRow: string[],
    rows: AsyncIterable<string[]>
): Promise<void> => {
    const safeName = sanitizeFilename(filename)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`)
    res.write(buildCsvRow(headerRow) + '\n')

    for await (const row of rows) {
        if (res.destroyed) {
            break
        }
        res.write(buildCsvRow(row) + '\n')
    }

    res.end()
}

const writePdfSectionTitle = (doc: InstanceType<typeof PDFDocument>, title: string): void => {
    if (doc.y > doc.page.height - 100) {
        doc.addPage()
    }
    doc.moveDown(0.5)
    doc.fontSize(12).fillColor('#111827').text(title, { underline: true })
    doc.moveDown(0.25)
    doc.fontSize(10).fillColor('#374151')
}

const renderCustomReportPdf = (doc: InstanceType<typeof PDFDocument>, report: CustomReportResult): void => {
    doc.fontSize(18).fillColor('#111827').text('Corvale Financial Report')
    doc.moveDown(0.25)
    doc.fontSize(10).fillColor('#6b7280').text(`Period: ${report.periodStart} to ${report.periodEnd}`)
    doc.fontSize(10).text(`Period type: ${report.periodType}`)
    doc.moveDown(0.75)

    let currentSection = ''
    for (const row of flattenCustomReport(report)) {
        if (row.section !== currentSection) {
            currentSection = row.section
            writePdfSectionTitle(doc, currentSection)
        }

        if (doc.y > doc.page.height - 60) {
            doc.addPage()
            doc.fontSize(10).fillColor('#374151')
        }

        doc.text(`${row.key}: ${row.value}`)
    }
}

export const sendCustomReportExport = (
    res: Response,
    format: ExportFormat,
    filename: string,
    report: CustomReportResult
): void => {
    sendExportResponse(res, format, filename, {
        csvContent: customReportToCsv(report),
        jsonContent: report,
        renderPdf: (doc) => renderCustomReportPdf(doc, report),
    })
}

export const buildTransactionExportRecord = (
    transaction: SerializedTransaction,
    categoryName: string
): TransactionExportRecord => {
    const [type, title, amount, currency, category, date, description, source, paymentMethod, tags, status] =
        formatTransactionCsvRow(transaction, categoryName)

    return {
        type,
        title,
        amount: Number(amount),
        currency,
        category,
        date,
        description,
        source,
        paymentMethod,
        tags,
        status,
    }
}

export const transactionsToCsv = (records: TransactionExportRecord[]): string => {
    const rows = [
        CSV_HEADERS,
        ...records.map((record) => [
            record.type,
            record.title,
            record.amount.toFixed(2),
            record.currency,
            record.category,
            record.date,
            record.description,
            record.source,
            record.paymentMethod,
            record.tags,
            record.status,
        ]),
    ]

    return buildCsvString(rows)
}

const renderTransactionsPdf = (
    doc: InstanceType<typeof PDFDocument>,
    payload: TransactionExportPayload
): void => {
    doc.fontSize(18).fillColor('#111827').text('Corvale Transactions Export')
    doc.moveDown(0.25)
    doc.fontSize(10).fillColor('#6b7280')
    doc.text(`Exported: ${payload.exportedAt}`)
    doc.text(`Transactions: ${payload.count}`)

    if (payload.filters.type) {
        doc.text(`Type filter: ${payload.filters.type}`)
    }
    if (payload.filters.startDate && payload.filters.endDate) {
        doc.text(`Date range: ${payload.filters.startDate} to ${payload.filters.endDate}`)
    }

    doc.moveDown(0.75)
    doc.fontSize(10).fillColor('#374151')

    if (payload.transactions.length === 0) {
        doc.text('No transactions matched the selected filters.')
        return
    }

    for (const record of payload.transactions) {
        if (doc.y > doc.page.height - 80) {
            doc.addPage()
            doc.fontSize(10).fillColor('#374151')
        }

        doc.font('Helvetica-Bold').text(`${record.date} · ${record.type.toUpperCase()} · ${record.title}`)
        doc.font('Helvetica').text(
            `${record.amount.toFixed(2)} ${record.currency}${record.category ? ` · ${record.category}` : ''}`
        )

        if (record.description) {
            doc.text(record.description)
        }

        doc.moveDown(0.5)
    }
}

export const sendTransactionExport = (
    res: Response,
    format: ExportFormat,
    filename: string,
    payload: TransactionExportPayload
): void => {
    sendExportResponse(res, format, filename, {
        csvContent: transactionsToCsv(payload.transactions),
        jsonContent: payload,
        renderPdf: (doc) => renderTransactionsPdf(doc, payload),
    })
}
