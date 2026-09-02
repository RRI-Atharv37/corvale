import express from 'express'

import {
    advanceOnboardingStep,
    getOnboardingStatus,
    replayOnboarding,
    skipOnboarding,
    startOnboarding,
} from './onboarding.controller'
import { protect } from '@http/middleware/authMiddleware'

const router = express.Router()

router.post('/start', protect, startOnboarding)
router.get('/status', protect, getOnboardingStatus)
router.post('/step/:step', protect, advanceOnboardingStep)
router.patch('/skip', protect, skipOnboarding)
router.post('/replay', protect, replayOnboarding)

export default router
