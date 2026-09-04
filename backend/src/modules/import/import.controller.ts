import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import {
    IMPORT_DELIMITERS,
    IMPORT_PREVIEW_SAMPLE_ROWS,
    ImportDelimiter,
    assertImportRowLimit,
    detectImportFormat,
    isOfxContent,
    isQifContent,
    parseCsvContent,
    parseOfxContent,
    parseQifContent,
    suggestColumnMapping,
} from './csvImportUtils'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateRequiredFields } from '@core/http/validation'
import {
    commitImport as commitImportService,
    previewImport as previewImportService,
} from './import.service'

export const parseImportFile = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.FILE_REQUIRED, 400)
    }

    const content = req.file.buffer.toString('utf-8')
    if (!content.trim()) {
        throw new CustomError(ERROR_MESSAGES.IMPORT.EMPTY_FILE, 400)
    }

    const extension = req.file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    const looksOfx = isOfxContent(content)
    const looksQif = !looksOfx && isQifContent(content)

    if (looksOfx || looksQif) {
        const parsed = looksQif ? parseQifContent(content) : parseOfxContent(content)
        assertImportRowLimit(parsed.rows.length + parsed.errors.length)

        handleResponses(res, 200, {
            format: looksQif ? 'qif' : 'ofx',
            fileName: req.file.originalname,
            totalRows: parsed.rows.length,
            sampleRows: parsed.rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
            parsedRows: parsed.rows,
            parsedRowErrors: parsed.errors,
            statementCurrency: parsed.statementCurrency,
            requiresMapping: false,
        })
        return
    }

    // An .ofx/.qfx upload whose content is neither OFX nor QIF must not fall through to the CSV
    // parser — that produced a garbled mapping screen or an opaque error (BUG-23).
    if (extension === '.ofx' || extension === '.qfx') {
        throw new CustomError('This file does not look like a valid OFX/QFX or QIF file', 400)
    }

    const requestedDelimiter =
        typeof req.body?.delimiter === 'string' ? (req.body.delimiter as string) : undefined
    const delimiter = IMPORT_DELIMITERS.includes(requestedDelimiter as ImportDelimiter)
        ? (requestedDelimiter as ImportDelimiter)
        : undefined

    const { headers, rows, delimiter: resolvedDelimiter } = parseCsvContent(content, delimiter)
    assertImportRowLimit(rows.length)

    const format = detectImportFormat(headers)
    const suggestedMapping = suggestColumnMapping(headers, format)

    handleResponses(res, 200, {
        format,
        fileName: req.file.originalname,
        headers,
        totalRows: rows.length,
        sampleRows: rows.slice(0, IMPORT_PREVIEW_SAMPLE_ROWS),
        rows,
        suggestedMapping,
        delimiter: resolvedDelimiter,
        requiresMapping: true,
    })
})

export const previewImport = asyncHandler(async (req: AuthRequest, res: Response) => {
    validateRequiredFields(req.body, ['accountId', 'defaultCategoryId'])

    const result = await previewImportService({
        userId: getUserId(req),
        accountId: req.body.accountId,
        defaultCategoryId: req.body.defaultCategoryId,
        workspaceId: req.body.workspaceId,
        body: req.body,
    })

    handleResponses(res, 200, result)
})

export const commitImport = asyncHandler(async (req: AuthRequest, res: Response) => {
    validateRequiredFields(req.body, ['accountId', 'defaultCategoryId'])

    const result = await commitImportService({
        userId: getUserId(req),
        accountId: req.body.accountId,
        defaultCategoryId: req.body.defaultCategoryId,
        workspaceId: req.body.workspaceId,
        body: req.body,
    })

    handleResponses(res, 201, result)
})
