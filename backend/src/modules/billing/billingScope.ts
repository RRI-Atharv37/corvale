import { Types, type Model } from 'mongoose'

import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { CustomError } from '@core/errors/customError'
import type { AuthRequest } from '@http/middleware/authTypes'

/** Resolves the workspace a request writes into, or null for the caller's personal data. */
export type BillingScope = (req: AuthRequest) => Promise<string | null> | string | null

/**
 * For routes that name the workspace explicitly (creates, list-scoped and sync calls). Never use it
 * on a by-id route: there the client-supplied field is not the truth, the stored resource is. A
 * gate must read the field its controller reads; prefer `scopeFromBody` / `scopeFromQuery` on a
 * wired route, since this one honours whichever of the two is present.
 */
export const scopeFromRequest: BillingScope = async (req) => {
    const fromBody = (req.body as { workspaceId?: unknown } | undefined)?.workspaceId
    const fromQuery = (req.query as { workspaceId?: unknown } | undefined)?.workspaceId
    return parseOptionalWorkspaceId(fromBody ?? fromQuery) ?? null
}

export const scopeFromBody: BillingScope = async (req) =>
    parseOptionalWorkspaceId((req.body as { workspaceId?: unknown } | undefined)?.workspaceId) ?? null

export const scopeFromQuery: BillingScope = async (req) =>
    parseOptionalWorkspaceId((req.query as { workspaceId?: unknown } | undefined)?.workspaceId) ?? null

/** For the routes that manage a workspace itself, where the workspace is the route's own param. */
export const scopeFromParam =
    (param = 'workspaceId'): BillingScope =>
    (req) => {
        const value = (req.params as Record<string, unknown> | undefined)?.[param]
        return typeof value === 'string' && value !== '' ? value : null
    }

/**
 * For by-id routes: the scope is whatever workspace the stored record belongs to, so a lapsed user
 * cannot borrow a workspace's plan by adding `?workspaceId=` to a request for their own record. A
 * missing or malformed id falls back to personal scope and lets the controller answer 404.
 */
const workspaceOfStoredResource = async <T extends { workspaceId?: Types.ObjectId | null }>(
    model: Model<T>,
    id: unknown
): Promise<string | null> => {
    if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) return null

    const resource = (await model.findById(id).select('workspaceId').lean()) as {
        workspaceId?: Types.ObjectId | null
    } | null
    return resource?.workspaceId ? resource.workspaceId.toString() : null
}

export const scopeFromResource =
    <T extends { workspaceId?: Types.ObjectId | null }>(model: Model<T>, idParam = 'id'): BillingScope =>
    (req) =>
        workspaceOfStoredResource(model, (req.params as Record<string, unknown> | undefined)?.[idParam])

/** For routes that carry one target record's id in the body. As with `scopeFromResource`, the stored record decides. */
export const scopeFromBodyResource =
    <T extends { workspaceId?: Types.ObjectId | null }>(model: Model<T>, field: string): BillingScope =>
    (req) => workspaceOfStoredResource(model, (req.body as Record<string, unknown> | undefined)?.[field])

export const DEFAULT_MAX_BULK_IDS = 500

/**
 * For bulk routes: one scope for the whole list, with every referenced record verified against it
 * before anything is judged on a plan. A list naming an unknown or malformed id is refused as not
 * found, and a list spanning more than one scope (personal and workspace, or two workspaces) is
 * refused outright, so a record can never ride along under another record's plan. A missing,
 * empty or oversized list is left to the controller to reject; it costs no lookup here.
 */
export const scopeFromBodyResources =
    <T extends { workspaceId?: Types.ObjectId | null }>(
        model: Model<T>,
        field: string,
        options: { notFoundMessage: string; mixedScopeMessage: string; max?: number }
    ): BillingScope =>
    async (req) => {
        const value = (req.body as Record<string, unknown> | undefined)?.[field]
        if (!Array.isArray(value) || value.length === 0 || value.length > (options.max ?? DEFAULT_MAX_BULK_IDS)) return null

        const ids: string[] = []
        for (const entry of value) {
            const id = typeof entry === 'string' ? entry.trim() : ''
            if (!Types.ObjectId.isValid(id)) throw new CustomError(options.notFoundMessage, 404)
            ids.push(id)
        }
        const unique = [...new Set(ids)]

        const found = (await model.find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } } as never)
            .select('workspaceId')
            .lean()) as Array<{ workspaceId?: Types.ObjectId | null }>
        if (found.length !== unique.length) throw new CustomError(options.notFoundMessage, 404)

        const scopes = new Set(found.map((record) => record.workspaceId?.toString() ?? null))
        if (scopes.size > 1) throw new CustomError(options.mixedScopeMessage, 400)

        return [...scopes][0] ?? null
    }
