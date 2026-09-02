import asyncHandler from 'express-async-handler'
import { Response } from 'express'

import Notification from './notification.model'
import { AuthRequest } from '@http/middleware/authTypes'
import { CustomError } from '@core/errors/customError'
import { ERROR_MESSAGES } from '@core/errors/errorMessages'
import { DEFAULT_TIMEZONE } from '@core/time/timezoneUtils'
import {
    attachBudgetContextToNotifications,
    syncBillDueNotifications,
} from './notificationUtils'
import { parseOptionalWorkspaceId } from '@core/access/workspace'
import { getUserId } from '@core/auth/requestUser'
import { handleResponses } from '@core/http/response'
import { validateOwnership } from '@core/access/ownership'
import { assertWorkspaceMembership } from "@modules/workspaces/access";

const getUserTimezone = (req: AuthRequest): string => {
    return req.user?.timezone?.trim() || DEFAULT_TIMEZONE
}

export const getNotifications = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const timezone = getUserTimezone(req)

    if (!req.user) {
        throw new CustomError(ERROR_MESSAGES.AUTH.NOT_AUTHORIZED, 401)
    }

    const workspaceId = parseOptionalWorkspaceId(req.query.workspaceId) ?? null
    if (workspaceId) {
        await assertWorkspaceMembership(workspaceId, userId, 'viewer')
    }

    await syncBillDueNotifications(userId, req.user, timezone, workspaceId)

    const notifications = await Notification.find({
        userId,
        dismissedAt: null,
    })
        .sort({ createdAt: -1 })
        .limit(50)

    const serialized = await attachBudgetContextToNotifications(notifications, userId)
    const unreadCount = notifications.filter((entry) => !entry.readAt).length

    handleResponses(res, 200, {
        notifications: serialized,
        unreadCount,
    })
})

export const markNotificationRead = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { notificationId } = req.params

    const notification = await validateOwnership(
        Notification,
        notificationId,
        userId,
        ERROR_MESSAGES.NOTIFICATION.NOTIFICATION_NOT_FOUND
    )

    if (!notification.readAt) {
        notification.readAt = new Date()
        await notification.save()
    }

    handleResponses(res, 200, { message: 'Notification marked as read' })
})

export const dismissNotification = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)
    const { notificationId } = req.params

    const notification = await validateOwnership(
        Notification,
        notificationId,
        userId,
        ERROR_MESSAGES.NOTIFICATION.NOTIFICATION_NOT_FOUND
    )

    notification.dismissedAt = new Date()
    if (!notification.readAt) {
        notification.readAt = new Date()
    }
    await notification.save()

    handleResponses(res, 200, { message: 'Notification dismissed' })
})

export const markAllNotificationsRead = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = getUserId(req)

    await Notification.updateMany(
        { userId, dismissedAt: null, readAt: null },
        { $set: { readAt: new Date() } }
    )

    handleResponses(res, 200, { message: 'All notifications marked as read' })
})
