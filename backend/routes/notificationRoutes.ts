import express from 'express'

import {
    dismissNotification,
    getNotifications,
    markAllNotificationsRead,
    markNotificationRead,
} from '../controllers/notificationController'
import { protect } from '../middleware/authMiddleware'

const router = express.Router()

router.get('/', protect, getNotifications)
router.patch('/read-all', protect, markAllNotificationsRead)
router.patch('/:notificationId/read', protect, markNotificationRead)
router.patch('/:notificationId/dismiss', protect, dismissNotification)

export default router
