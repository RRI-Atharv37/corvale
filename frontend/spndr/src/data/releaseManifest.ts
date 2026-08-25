import type { DesktopPlatformId } from '../utils/platformDetect'

export interface PlatformRelease {
    id: DesktopPlatformId
    label: string
    fileLabel: string
    /** null until a signed installer is actually published (blocked on D1/D8) */
    url: string | null
    sha256: string | null
    sizeBytes: number | null
    systemRequirements: string[]
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

const RELEASES_URL = 'https://github.com/RRI-Atharv37/spndr/releases'

// D1 (signing keypair, code-signing cert, notarization) and D8 (tagged releases, changelog,
// latest.json on GitHub Releases) have shipped as infrastructure - .github/workflows/release.yml
// builds and publishes installers on a version tag - but no release has actually been tagged yet,
// so there's still no real installer, checksum, or download URL to serve. This manifest is shaped
// like the real thing (mirrors the fields a GitHub Releases / Tauri latest.json response will
// carry) so that cutting the first release is a data change here, not a rewrite of the /download
// page. Windows/macOS OS-level code-signing (the SmartScreen/Gatekeeper trust prompt, distinct
// from the updater's own signing key) was deliberately not pursued - portfolio/personal
// deployment, not a product sold at scale. See TODO.md D1 and docs/desktop/download.md.
export const getReleaseManifest = (): ReleaseManifest => ({
    version: '0.1.0',
    publishedAt: null,
    available: false,
    releaseNotesUrl: RELEASES_URL,
    highlights: [
        'Native SQLite storage, encrypted at rest with SQLCipher',
        'Sign in once, then use spndr fully offline',
        'Automatic updates, verified against a signed release before install',
    ],
    platforms: [
        {
            id: 'windows',
            label: 'Windows',
            fileLabel: '.msi / .exe installer',
            url: null,
            sha256: null,
            sizeBytes: null,
            systemRequirements: [
                'Windows 10 or later (64-bit)',
                'WebView2 runtime (preinstalled on current Windows 10/11)',
            ],
        },
        {
            id: 'macos',
            label: 'macOS',
            fileLabel: '.dmg disk image',
            url: null,
            sha256: null,
            sizeBytes: null,
            systemRequirements: ['macOS 12 Monterey or later', 'Apple Silicon or Intel'],
        },
        {
            id: 'linux',
            label: 'Linux',
            fileLabel: '.deb, .rpm, or .AppImage',
            url: null,
            sha256: null,
            sizeBytes: null,
            systemRequirements: [
                'webkit2gtk 4.1 and libayatana-appindicator3',
                'A glibc-based distro (Debian/Ubuntu, Fedora, and derivatives)',
            ],
        },
    ],
})
