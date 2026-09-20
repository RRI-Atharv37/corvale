import { Types, type Model } from 'mongoose'

import { parseOptionalWorkspaceId } from '@core/access/workspace'
import type { AuthRequest } from '@http/middleware/authTypes'

/** Resolves the workspace a request writes into, or null for the caller's personal data. */
export type BillingScope = (req: AuthRequest) => Promise<string | null> | string | null

/**
 * For routes that name the workspace explicitly (creates, list-scoped and sync calls). Never use it
 * on a by-id route: there the client-supplied field is not the truth, the stored resource is.
 */
export const scopeFromRequest: BillingScope = async (req) => {
    const fromBody = (req.body as { workspaceId?: unknown } | undefined)?.workspaceId
    const fromQuery = (req.query as { workspaceId?: unknown } | undefined)?.workspaceId
    return parseOptionalWorkspaceId(fromBody ?? fromQuery) ?? null
}

/**
 * For by-id routes: the scope is whatever workspace the stored record belongs to, so a lapsed user
 * cannot borrow a workspace's plan by adding `?workspaceId=` to a request for their own record. A
 * missing or malformed id falls back to personal scope and lets the controller answer 404.
 */
export const scopeFromResource =
    <T extends { workspaceId?: Types.ObjectId | null }>(model: Model<T>, idParam = 'id'): BillingScope =>
    async (req) => {
        const id = (req.params as Record<string, unknown> | undefined)?.[idParam]
        if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) return null

        const resource = (await model.findById(id).select('workspaceId').lean()) as {
            workspaceId?: Types.ObjectId | null
        } | null
        return resource?.workspaceId ? resource.workspaceId.toString() : null
    }
