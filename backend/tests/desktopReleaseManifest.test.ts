import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

import { createApp } from '../app'
import {
    clearReleaseCache,
    getLatestDesktopRelease,
    setReleaseClock,
    setReleaseSource,
    transformGithubRelease,
} from '../services/desktopReleaseService'
import { CustomError } from '../utils/customError'

/**
 * V16 - `/download` self-updating.
 *
 * `GET /api/v1/desktop/release-manifest` proxies the GitHub Releases API server-side (no browser
 * CORS, no per-visitor rate limit) with a short in-memory cache and serve-stale-on-error, so the
 * public `/download` page always reflects the newest desktop build with no frontend redeploy.
 *
 * Contract these tests pin:
 *   backend/services/desktopReleaseService.ts
 *     transformGithubRelease(raw)  -- GitHub `releases/latest` JSON -> { version, tag, publishedAt,
 *       releaseNotesUrl, assets: [{ name, url, sha256, sizeBytes }] }; installer files only,
 *       `sha256:` prefix stripped off the asset `digest`, throws CustomError(502) with no tag.
 *     getLatestDesktopRelease()    -- cached (TTL), serves the last good payload if a refresh fails.
 *     setReleaseSource(src|null)   -- test seam, mirrors captchaService's setCaptchaVerifier.
 *     setReleaseClock(fn|null)     -- test seam for TTL expiry.
 *     clearReleaseCache()          -- test seam.
 */

const GITHUB_RELEASE = {
    tag_name: 'v1.3.0',
    published_at: '2026-09-10T09:00:00Z',
    html_url: 'https://github.com/RRI-Atharv37/corvale/releases/tag/v1.3.0',
    assets: [
        {
            name: 'Corvale_1.3.0_x64_en-US.msi',
            size: 7_900_000,
            browser_download_url:
                'https://github.com/RRI-Atharv37/corvale/releases/download/v1.3.0/Corvale_1.3.0_x64_en-US.msi',
            digest: `sha256:${'a'.repeat(64)}`,
        },
        {
            name: 'Corvale_1.3.0_aarch64.dmg',
            size: 8_200_000,
            browser_download_url:
                'https://github.com/RRI-Atharv37/corvale/releases/download/v1.3.0/Corvale_1.3.0_aarch64.dmg',
            digest: null,
        },
        {
            name: 'latest.json',
            size: 900,
            browser_download_url: 'https://github.com/x/releases/download/v1.3.0/latest.json',
            digest: null,
        },
        {
            name: 'Corvale_1.3.0_x64_en-US.msi.sig',
            size: 96,
            browser_download_url: 'https://github.com/x/releases/download/v1.3.0/sig',
            digest: null,
        },
    ],
}

afterEach(() => {
    setReleaseSource(null)
    setReleaseClock(null)
    clearReleaseCache()
    vi.restoreAllMocks()
})

describe('transformGithubRelease', () => {
    it('keeps only installer assets, strips the sha256: prefix, and sorts by name', () => {
        const payload = transformGithubRelease(GITHUB_RELEASE)

        expect(payload.version).toBe('1.3.0')
        expect(payload.tag).toBe('v1.3.0')
        expect(payload.publishedAt).toBe('2026-09-10T09:00:00Z')
        expect(payload.releaseNotesUrl).toBe(
            'https://github.com/RRI-Atharv37/corvale/releases/tag/v1.3.0'
        )
        expect(payload.assets.map((asset) => asset.name)).toEqual([
            'Corvale_1.3.0_aarch64.dmg',
            'Corvale_1.3.0_x64_en-US.msi',
        ])

        const msi = payload.assets.find((asset) => asset.name.endsWith('.msi'))
        expect(msi?.sha256).toBe('a'.repeat(64))
        expect(msi?.sizeBytes).toBe(7_900_000)
        expect(msi?.url).toContain('/releases/download/v1.3.0/Corvale_1.3.0_x64_en-US.msi')
        expect(payload.assets.find((asset) => asset.name.endsWith('.dmg'))?.sha256).toBeNull()
    })

    it('throws a 502 when the release has no tag', () => {
        try {
            transformGithubRelease({ ...GITHUB_RELEASE, tag_name: undefined })
            expect.unreachable('expected transformGithubRelease to throw')
        } catch (error) {
            expect(error).toBeInstanceOf(CustomError)
            expect((error as CustomError).statusCode).toBe(502)
        }
    })
})

describe('getLatestDesktopRelease', () => {
    it('caches the payload for the TTL, then refetches once it expires', async () => {
        const source = vi.fn(async () => transformGithubRelease(GITHUB_RELEASE))
        setReleaseSource({ fetchLatestRelease: source })

        let now = 1_000_000
        setReleaseClock(() => now)

        await getLatestDesktopRelease()
        await getLatestDesktopRelease()
        expect(source).toHaveBeenCalledTimes(1)

        now += 60 * 60 * 1000 // an hour later
        await getLatestDesktopRelease()
        expect(source).toHaveBeenCalledTimes(2)
    })

    it('serves the last good payload when a later refresh fails', async () => {
        let mode: 'ok' | 'fail' = 'ok'
        setReleaseSource({
            fetchLatestRelease: async () => {
                if (mode === 'fail') throw new Error('GitHub unreachable')
                return transformGithubRelease(GITHUB_RELEASE)
            },
        })

        let now = 1_000_000
        setReleaseClock(() => now)

        const first = await getLatestDesktopRelease()
        expect(first.version).toBe('1.3.0')

        mode = 'fail'
        now += 60 * 60 * 1000
        const stale = await getLatestDesktopRelease()
        expect(stale.version).toBe('1.3.0')
    })

    it('surfaces a 502 CustomError when the source fails with nothing cached', async () => {
        setReleaseSource({
            fetchLatestRelease: async () => {
                throw new Error('GitHub unreachable')
            },
        })

        await expect(getLatestDesktopRelease()).rejects.toMatchObject({ statusCode: 502 })
    })
})

describe('GET /api/v1/desktop/release-manifest', () => {
    it('returns the transformed manifest, no auth required, with a cache header', async () => {
        setReleaseSource({
            fetchLatestRelease: async () => transformGithubRelease(GITHUB_RELEASE),
        })
        const app = createApp()

        const res = await request(app).get('/api/v1/desktop/release-manifest')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.version).toBe('1.3.0')
        expect(res.body.data.assets).toHaveLength(2)
        expect(res.headers['cache-control']).toMatch(/max-age=\d+/)
    })

    it('responds 502 when the release data cannot be retrieved', async () => {
        setReleaseSource({
            fetchLatestRelease: async () => {
                throw new Error('GitHub unreachable')
            },
        })
        const app = createApp()

        const res = await request(app).get('/api/v1/desktop/release-manifest')

        expect(res.status).toBe(502)
        expect(res.body.success).toBe(false)
    })
})
