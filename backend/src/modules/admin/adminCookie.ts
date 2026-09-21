import type { Response } from 'express'

import { ADMIN_REFRESH_COOKIE, ADMIN_REFRESH_COOKIE_PATH } from './adminConfig'

const baseOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: ADMIN_REFRESH_COOKIE_PATH,
})

/** SameSite=Strict and scoped to the admin auth path, so the cookie is never sent to any other route or site. */
export const setAdminRefreshCookie = (res: Response, token: string, expiresAt: Date): void => {
    res.cookie(ADMIN_REFRESH_COOKIE, token, { ...baseOptions(), maxAge: Math.max(0, expiresAt.getTime() - Date.now()) })
}

export const clearAdminRefreshCookie = (res: Response): void => {
    res.clearCookie(ADMIN_REFRESH_COOKIE, baseOptions())
}

export const readAdminRefreshCookie = (cookies: Record<string, string | undefined> | undefined): string | null =>
    cookies?.[ADMIN_REFRESH_COOKIE] ?? null
