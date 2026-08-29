import { Router } from 'express'

import { getDesktopReleaseManifest } from '../controllers/desktopController'

const router = Router()

// Public - no `protect`. Feeds the `/download` page's installer list (V16).
router.get('/release-manifest', getDesktopReleaseManifest)

export default router
