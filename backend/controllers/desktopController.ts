import asyncHandler from 'express-async-handler'
import { Request, Response } from 'express'

import { getLatestDesktopRelease } from '../services/desktopReleaseService'
import { handleResponses } from '@core/http/response'

/**
 * V16 - public: powers the `/download` page. Returns the newest desktop release's installer list
 * (version, per-file URL / checksum / size) from a cached GitHub proxy. No auth: `/download` is a
 * marketing page. The `Cache-Control` lets the browser and any CDN hold it briefly - the data
 * only changes when a release is published.
 */
export const getDesktopReleaseManifest = asyncHandler(async (_req: Request, res: Response) => {
    const payload = await getLatestDesktopRelease()
    res.set('Cache-Control', 'public, max-age=300')
    handleResponses(res, 200, payload)
})
