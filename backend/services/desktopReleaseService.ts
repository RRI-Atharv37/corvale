import { CustomError } from '../utils/customError'
import { ERROR_MESSAGES } from '../utils/errorMessages'

/**
 * V16 - server-side proxy for the desktop `/download` page's release data.
 *
 * The public `/download` page can't fetch GitHub directly: `github.com` release-asset URLs send
 * no CORS headers, and hitting `api.github.com` from every visitor's browser would both widen the
 * app's strict CSP and burn the unauthenticated 60-req/hr/IP budget. So the backend fetches
 * `api.github.com/repos/<repo>/releases/latest` once, caches it briefly, and serves the last good
 * copy if a later refresh fails - the page then always reflects the newest published build with
 * no frontend redeploy. Mirrors `utils/captchaService.ts`'s injectable-source seam for tests.
 */

// The repo that publishes desktop releases - kept in step with the frontend's `REPO_URL` in
// `src/data/releaseManifest.ts`. V13 (repo rename) updates both, plus the updater endpoint.
const RELEASES_REPO = 'RRI-Atharv37/corvale'
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
const CACHE_TTL_MS = 10 * 60 * 1000

const INSTALLER_EXTENSIONS = ['.msi', '.exe', '.dmg', '.deb', '.rpm', '.appimage']
const isInstaller = (name: string): boolean =>
    INSTALLER_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension))

export interface ReleaseManifestAsset {
    name: string
    url: string
    sha256: string | null
    sizeBytes: number | null
}

export interface ReleaseManifestPayload {
    version: string
    tag: string
    publishedAt: string | null
    releaseNotesUrl: string | null
    assets: ReleaseManifestAsset[]
}

export interface ReleaseSource {
    fetchLatestRelease(): Promise<ReleaseManifestPayload>
}

interface GithubReleaseAsset {
    name?: unknown
    size?: unknown
    browser_download_url?: unknown
    digest?: unknown
}

interface GithubRelease {
    tag_name?: unknown
    published_at?: unknown
    html_url?: unknown
    assets?: unknown
}

const stripSha256Prefix = (digest: unknown): string | null => {
    if (typeof digest !== 'string') return null
    const match = digest.match(/^sha256:([0-9a-f]{64})$/i)
    return match ? match[1].toLowerCase() : null
}

/** Reduce a GitHub `releases/latest` response to just what `/download` renders. */
export const transformGithubRelease = (raw: GithubRelease): ReleaseManifestPayload => {
    const tag = typeof raw.tag_name === 'string' ? raw.tag_name : ''
    if (!tag) {
        throw new CustomError(ERROR_MESSAGES.DESKTOP.RELEASE_UNAVAILABLE, 502)
    }

    const rawAssets: GithubReleaseAsset[] = Array.isArray(raw.assets)
        ? (raw.assets as GithubReleaseAsset[])
        : []

    const assets = rawAssets
        .filter(
            (asset): asset is GithubReleaseAsset & { name: string } =>
                typeof asset.name === 'string' && isInstaller(asset.name)
        )
        .map((asset) => ({
            name: asset.name,
            url:
                typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
            sha256: stripSha256Prefix(asset.digest),
            sizeBytes: typeof asset.size === 'number' ? asset.size : null,
        }))
        .filter((asset) => asset.url !== '')
        .sort((a, b) => a.name.localeCompare(b.name))

    return {
        version: tag.replace(/^v/, ''),
        tag,
        publishedAt: typeof raw.published_at === 'string' ? raw.published_at : null,
        releaseNotesUrl: typeof raw.html_url === 'string' ? raw.html_url : null,
        assets,
    }
}

const githubReleaseSource: ReleaseSource = {
    fetchLatestRelease: async () => {
        const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'corvale-download-page',
            },
        })
        if (!response.ok) {
            throw new CustomError(ERROR_MESSAGES.DESKTOP.RELEASE_UNAVAILABLE, 502)
        }
        return transformGithubRelease((await response.json()) as GithubRelease)
    },
}

let testSource: ReleaseSource | null = null
/** Test-only hook to inject a fake release source without a live GitHub call. */
export const setReleaseSource = (source: ReleaseSource | null): void => {
    testSource = source
}

let clock: () => number = () => Date.now()
/** Test-only hook to drive cache-TTL expiry deterministically. */
export const setReleaseClock = (fn: (() => number) | null): void => {
    clock = fn ?? (() => Date.now())
}

interface CacheEntry {
    payload: ReleaseManifestPayload
    fetchedAt: number
}
let cache: CacheEntry | null = null

/** Test-only hook to drop the module-level cache between cases. */
export const clearReleaseCache = (): void => {
    cache = null
}

export const getLatestDesktopRelease = async (): Promise<ReleaseManifestPayload> => {
    const now = clock()
    if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.payload
    }

    try {
        const payload = await (testSource ?? githubReleaseSource).fetchLatestRelease()
        cache = { payload, fetchedAt: now }
        return payload
    } catch (error) {
        // Serve stale on error - a transient GitHub outage or rate limit shouldn't blank the page.
        if (cache) {
            return cache.payload
        }
        throw error instanceof CustomError
            ? error
            : new CustomError(ERROR_MESSAGES.DESKTOP.RELEASE_UNAVAILABLE, 502)
    }
}
