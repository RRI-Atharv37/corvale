import type { DesktopPlatformId } from '../utils/platformDetect'

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
    version: string
    publishedAt: string | null
    /** false until D1 (signing/notarization) and D8 (release process) ship a real installer */
    available: boolean
    releaseNotesUrl: string
    highlights: string[]
    platforms: PlatformRelease[]
}

const REPO_URL = 'https://github.com/RRI-Atharv37/spndr'
const RELEASE_TAG = 'v0.17.0'
const ASSETS_URL = `${REPO_URL}/releases/download/${RELEASE_TAG}`

// D6b: real data from the published v0.17.0 GitHub Release (each OS's Tauri build produces more
// than one installer format - Windows: .msi + .exe; macOS: aarch64 + x64 .dmg; Linux: .deb + .rpm
// + .AppImage - see .github/workflows/release.yml). One canonical format per OS is the primary
// download; the rest are listed under "see all formats" on /download rather than only linking out
// to the GitHub release. SHA-256 values are the GitHub asset digests for the exact uploaded files.
export const getReleaseManifest = (): ReleaseManifest => ({
    version: '0.17.0',
    publishedAt: '2026-08-25T20:31:20Z',
    available: true,
    releaseNotesUrl: `${REPO_URL}/releases/tag/${RELEASE_TAG}`,
    highlights: [
        'Native SQLite storage, encrypted at rest with SQLCipher',
        'Sign in once, then use Corvale fully offline',
        'Automatic updates, verified against a signed release before install',
    ],
    platforms: [
        {
            id: 'windows',
            label: 'Windows',
            fileLabel: '.msi installer',
            systemRequirements: [
                'Windows 10 or later (64-bit)',
                'WebView2 runtime (preinstalled on current Windows 10/11)',
            ],
            primary: {
                label: '.msi installer',
                url: `${ASSETS_URL}/spndr_0.17.0_x64_en-US.msi`,
                sha256: '676ecbfaaa041b6d577ea9b2a5c1857b78881ad1b0b38ce0798b9e7540444c19',
                sizeBytes: 7827456,
            },
            alternates: [
                {
                    label: '.exe installer',
                    url: `${ASSETS_URL}/spndr_0.17.0_x64-setup.exe`,
                    sha256: '765b578758ab9b59688f18e95485f6cef9e75f026092e68f21d77c5a99f4bab8',
                    sizeBytes: 5811999,
                },
            ],
        },
        {
            id: 'macos',
            label: 'macOS',
            fileLabel: '.dmg disk image (Apple Silicon)',
            systemRequirements: ['macOS 12 Monterey or later', 'Apple Silicon or Intel'],
            primary: {
                label: 'Apple Silicon (.dmg)',
                url: `${ASSETS_URL}/spndr_0.17.0_aarch64.dmg`,
                sha256: '62f7942284492aa568b286c3f5f932904436961f104b00682d17cadcaaec8adc',
                sizeBytes: 8088151,
            },
            alternates: [
                {
                    label: 'Intel (.dmg)',
                    url: `${ASSETS_URL}/spndr_0.17.0_x64.dmg`,
                    sha256: 'd3171b743864f6fa3e66084deb11c996bbec7a89f2891b0013ae0db33c7d3fdd',
                    sizeBytes: 8190126,
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
            primary: {
                label: '.deb package',
                url: `${ASSETS_URL}/spndr_0.17.0_amd64.deb`,
                sha256: 'f13718e71fec33b5ffb1ad5f2faddc5f209503e56a5c3a57f2d5b485fc37d0d5',
                sizeBytes: 8467760,
            },
            alternates: [
                {
                    label: '.rpm package',
                    url: `${ASSETS_URL}/spndr-0.17.0-1.x86_64.rpm`,
                    sha256: '368f0c21d9b282328be151ed843f754a7ddf8b76a65a73049b27b70f4b74aa78',
                    sizeBytes: 8467532,
                },
                {
                    label: '.AppImage',
                    url: `${ASSETS_URL}/spndr_0.17.0_amd64.AppImage`,
                    sha256: '52cef0b821ea46311c3b800364997a38e0bd72cb729b7b708bc083c4303be731',
                    sizeBytes: 85588472,
                },
            ],
        },
    ],
})
