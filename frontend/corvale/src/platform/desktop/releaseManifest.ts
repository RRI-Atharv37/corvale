import { API_PATHS, BASE_URL } from '@lib/apiPaths'
import type { DesktopPlatformId } from '@lib/platformDetect'

export interface ReleaseAsset {
    label: string
    url: string | null
    sha256: string | null
    sizeBytes: number | null
}

export interface PlatformRelease {
    id: DesktopPlatformId
    label: string
    fileLabel: string
    systemRequirements: string[]
    /** The canonical, one-click download for this OS. */
    primary: ReleaseAsset
    /** Other installer formats for the same OS, surfaced behind "see all formats". */
    alternates: ReleaseAsset[]
}

export interface ReleaseManifest {
    /** null for the installer-free fallback, which is not tied to any release. */
    version: string | null
    publishedAt: string | null
    /** false until D1 (signing/notarization) and D8 (release process) ship a real installer */
    available: boolean
    releaseNotesUrl: string
    highlights: string[]
    platforms: PlatformRelease[]
}

const REPO_URL = 'https://github.com/RRI-Atharv37/corvale'

/**
 * Fetched at runtime by `/download` (V16). `GET /api/v1/desktop/release-manifest` proxies the
 * GitHub Releases API server-side and caches it, so the page always reflects the newest published
 * desktop build with no frontend redeploy - and without the browser needing a CORS exception or a
 * widened CSP (GitHub's own asset URLs send no CORS headers).
 */
export const LIVE_RELEASE_MANIFEST_URL = `${BASE_URL}${API_PATHS.DESKTOP.RELEASE_MANIFEST}`

export const LATEST_RELEASE_URL = `${REPO_URL}/releases/latest`

const RELEASE_HIGHLIGHTS = [
    'Native SQLite storage, encrypted at rest with SQLCipher',
    'Sign in once, then use Corvale fully offline',
    'Automatic updates, verified against a signed release before install',
]

// ---------------------------------------------------------------------------
// V16 - live `/download` manifest (fetched at runtime from the published release)
// ---------------------------------------------------------------------------

/** One installer file listed on the release, as published in `download-manifest.json`. */
export interface DownloadManifestAsset {
    name: string
    url: string
    sha256: string | null
    sizeBytes: number | null
}

/** Shape of the `download-manifest.json` asset that `release.yml` publishes per release. */
export interface DownloadManifestWire {
    version: string
    tag: string
    publishedAt: string | null
    releaseNotesUrl?: string
    assets: DownloadManifestAsset[]
}

interface AssetSlot {
    label: string
    /** Picks this slot's file out of the release's installer list by filename. */
    matches: (assetName: string) => boolean
}

interface PlatformTemplate {
    id: DesktopPlatformId
    label: string
    fileLabel: string
    systemRequirements: string[]
    primary: AssetSlot
    alternates: AssetSlot[]
}

const hasExtension = (name: string, extension: string): boolean =>
    name.toLowerCase().endsWith(extension)

// Editorial content (labels, requirements, which format is the one-click download) lives here;
// only the per-asset URL / checksum / size come from the fetched manifest. Matchers key off the
// Tauri bundler's output names (e.g. `Corvale_1.2.0_aarch64.dmg`, `Corvale_1.2.0_x64-setup.exe`),
// which are stable across the version number and the spndr -> Corvale rename.
const PLATFORM_TEMPLATES: PlatformTemplate[] = [
    {
        id: 'windows',
        label: 'Windows',
        fileLabel: '.msi installer',
        systemRequirements: [
            'Windows 10 or later (64-bit)',
            'WebView2 runtime (preinstalled on current Windows 10/11)',
        ],
        primary: { label: '.msi installer', matches: (name) => hasExtension(name, '.msi') },
        alternates: [{ label: '.exe installer', matches: (name) => hasExtension(name, '.exe') }],
    },
    {
        id: 'macos',
        label: 'macOS',
        fileLabel: '.dmg disk image (Apple Silicon)',
        systemRequirements: ['macOS 12 Monterey or later', 'Apple Silicon or Intel'],
        primary: {
            label: 'Apple Silicon (.dmg)',
            matches: (name) => hasExtension(name, '.dmg') && /aarch64|arm64/i.test(name),
        },
        alternates: [
            {
                label: 'Intel (.dmg)',
                matches: (name) => hasExtension(name, '.dmg') && /x64|x86[_-]?64|intel/i.test(name),
            },
        ],
    },
    {
        id: 'linux',
        label: 'Linux',
        fileLabel: '.deb package',
        systemRequirements: [
            'webkit2gtk 4.1 and libayatana-appindicator3',
            'A glibc-based distro (Debian/Ubuntu, Fedora, and derivatives)',
        ],
        primary: { label: '.deb package', matches: (name) => hasExtension(name, '.deb') },
        alternates: [
            { label: '.rpm package', matches: (name) => hasExtension(name, '.rpm') },
            { label: '.AppImage', matches: (name) => hasExtension(name, '.appimage') },
        ],
    },
]

const resolveSlot = (slot: AssetSlot, assets: DownloadManifestAsset[]): ReleaseAsset => {
    const hit = assets.find((asset) => slot.matches(asset.name))
    return hit
        ? { label: slot.label, url: hit.url, sha256: hit.sha256, sizeBytes: hit.sizeBytes }
        : { label: slot.label, url: null, sha256: null, sizeBytes: null }
}

/** Fold a fetched `download-manifest.json` into the editorial templates for `/download` to render. */
export const mergeDownloadManifest = (wire: DownloadManifestWire): ReleaseManifest => {
    const platforms: PlatformRelease[] = PLATFORM_TEMPLATES.map((template) => ({
        id: template.id,
        label: template.label,
        fileLabel: template.fileLabel,
        systemRequirements: template.systemRequirements,
        primary: resolveSlot(template.primary, wire.assets),
        alternates: template.alternates
            .map((slot) => resolveSlot(slot, wire.assets))
            .filter((asset) => asset.url !== null),
    }))

    return {
        version: wire.version,
        publishedAt: wire.publishedAt,
        available: platforms.some((platform) => platform.primary.url !== null),
        releaseNotesUrl: wire.releaseNotesUrl ?? `${REPO_URL}/releases/tag/${wire.tag}`,
        highlights: RELEASE_HIGHLIGHTS,
        platforms,
    }
}

/**
 * What `/download` renders before the live manifest resolves, and keeps if it never does: every
 * platform card with no installer link, pointing at the latest-release page. Nothing here is pinned
 * to a version, so a stale build can never be offered.
 */
export const getFallbackReleaseManifest = (): ReleaseManifest => ({
    version: null,
    publishedAt: null,
    available: false,
    releaseNotesUrl: LATEST_RELEASE_URL,
    highlights: RELEASE_HIGHLIGHTS,
    platforms: PLATFORM_TEMPLATES.map((template) => ({
        id: template.id,
        label: template.label,
        fileLabel: template.fileLabel,
        systemRequirements: template.systemRequirements,
        primary: resolveSlot(template.primary, []),
        alternates: [],
    })),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const asStringOrNull = (value: unknown): string | null =>
    typeof value === 'string' ? value : null

const asFiniteNumberOrNull = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

/** Validate an untrusted `download-manifest.json` payload; throws on anything malformed. */
export const parseDownloadManifestWire = (raw: unknown): DownloadManifestWire => {
    if (!isRecord(raw)) {
        throw new Error('download manifest: payload is not an object')
    }
    if (typeof raw.version !== 'string' || raw.version.length === 0) {
        throw new Error('download manifest: missing "version"')
    }
    if (!Array.isArray(raw.assets)) {
        throw new Error('download manifest: "assets" is not an array')
    }

    const assets: DownloadManifestAsset[] = raw.assets.map((entry, index) => {
        if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.url !== 'string') {
            throw new Error(`download manifest: asset ${index} is missing name/url`)
        }
        return {
            name: entry.name,
            url: entry.url,
            sha256: asStringOrNull(entry.sha256),
            sizeBytes: asFiniteNumberOrNull(entry.sizeBytes),
        }
    })

    return {
        version: raw.version,
        tag:
            typeof raw.tag === 'string' && raw.tag.length > 0 ? raw.tag : `v${raw.version}`,
        publishedAt: asStringOrNull(raw.publishedAt),
        releaseNotesUrl: typeof raw.releaseNotesUrl === 'string' ? raw.releaseNotesUrl : undefined,
        assets,
    }
}

/**
 * Fetch the live release manifest from the backend proxy and fold it into the editorial templates.
 * Rejects on a network failure, a non-2xx response, or a malformed payload - `/download` catches
 * that and keeps the built-in fallback.
 */
export const fetchLiveReleaseManifest = async (): Promise<ReleaseManifest> => {
    const response = await fetch(LIVE_RELEASE_MANIFEST_URL, {
        headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
        throw new Error(`release-manifest responded ${response.status}`)
    }
    const body = (await response.json()) as { success?: boolean; data?: unknown }
    if (body?.success !== true) {
        throw new Error('release-manifest: unexpected response shape')
    }
    return mergeDownloadManifest(parseDownloadManifestWire(body.data))
}
